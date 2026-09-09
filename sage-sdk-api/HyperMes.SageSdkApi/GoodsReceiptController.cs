using Pastel.Evolution;
using System;
using System.Collections.Concurrent;
using System.Data;
using System.Data.SqlClient;
using System.Linq;
using System.Net;
using System.Web.Http;

namespace SDK_Test
{
    [RoutePrefix("api/v1/goods-receipts")]
    public class GoodsReceiptController : ApiController
    {
        private static readonly ConcurrentDictionary<string, bool> PostedReferences =
            new ConcurrentDictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

        [HttpPost]
        [Route("validate")]
        public IHttpActionResult ValidateGoodsReceipt(GoodsReceiptRequest request)
        {
            var error = ValidateRequest(request);
            if (error != null)
                return BadRequest(error);

            lock (SdkSession.OperationLock)
            {
                SdkSession.EnsureConnected();
                ValidateSageMastersWithReconnect(request);
            }

            return Ok(new
            {
                status = "validated",
                environment = SageRuntime.EnvironmentName,
                action = "goods-receipt-grv",
                sageConnection = "verified",
                sagePosting = "not performed",
                message = "Validated against the configured Sage company. No GRV was created.",
                goodsReceipt = GoodsReceiptSummary(request, null)
            });
        }

        [HttpPost]
        [Route("post")]
        public IHttpActionResult PostGoodsReceipt(GoodsReceiptRequest request)
        {
            var error = ValidateRequest(request);
            if (error != null)
                return BadRequest(error);

            if (!request.ConfirmPost)
            {
                return BadRequest(
                    "Posting is blocked. Set confirmPost to true only after approval.");
            }

            var reference = request.Reference.Trim();
            if (!PostedReferences.TryAdd(reference, true))
                return StatusCode(System.Net.HttpStatusCode.Conflict);

            try
            {
                string grvNumber;
                string supplierInvoiceNumber;
                string outcome;
                lock (SdkSession.OperationLock)
                {
                    SdkSession.EnsureConnected();
                    ValidateSageMastersWithReconnect(request);
                    EnsureFullGrnWorkflowIsAllowed(request);
                    var checkpoint = FindSageCheckpoint(request);
                    if (checkpoint.SupplierInvoicePosted)
                    {
                        grvNumber = checkpoint.GrvNumber;
                        supplierInvoiceNumber = checkpoint.SupplierInvoiceNumber;
                        outcome = "already-posted";
                    }
                    else if (!string.IsNullOrWhiteSpace(checkpoint.GrvNumber) &&
                             !string.IsNullOrWhiteSpace(checkpoint.OrderNumber))
                    {
                        grvNumber = checkpoint.GrvNumber;
                        supplierInvoiceNumber = CompleteSupplierInvoice(
                            checkpoint.OrderNumber,
                            checkpoint.GrvNumber,
                            request);
                        outcome = "resumed-supplier-invoice";
                    }
                    else
                    {
                        var purchaseOrder = PrepareGoodsReceivedVoucherWithReconnect(request);
                        grvNumber = purchaseOrder.ProcessStock();
                        ThrowIfSimulatedApInterruption(request, grvNumber);
                        supplierInvoiceNumber = CompleteSupplierInvoice(
                            purchaseOrder.OrderNo,
                            grvNumber,
                            request);
                        outcome = "posted";
                    }
                }

                return Ok(new
                {
                    status = outcome,
                    environment = SageRuntime.EnvironmentName,
                    action = "goods-receipt-grv",
                    sagePosting = "completed",
                    grvNumber = grvNumber,
                    documentNumber = grvNumber,
                    supplierInvoiceNumber = supplierInvoiceNumber,
                    message = outcome == "already-posted"
                        ? "Sage already contains this GRN's GRV and supplier invoice."
                        : "Goods receipt and supplier invoice posted to the configured Sage company.",
                    goodsReceipt = GoodsReceiptSummary(request, grvNumber)
                });
            }
            catch (Exception ex)
            {
                bool removed;
                PostedReferences.TryRemove(reference, out removed);

                return Content(HttpStatusCode.InternalServerError, new
                {
                    status = "failed",
                    environment = SageRuntime.EnvironmentName,
                    action = "goods-receipt-grv",
                    message = "Sage could not post this goods receipt GRV.",
                    exception = ex.GetType().FullName,
                    exceptionMessage = ex.Message,
                    detail = ex.ToString()
                });
            }
        }

        private static void EnsureFullGrnWorkflowIsAllowed(GoodsReceiptRequest request)
        {
            var enabled = string.Equals(
                Environment.GetEnvironmentVariable("HYPER_SAGE_FULL_GRN_WORKFLOW"),
                "true",
                StringComparison.OrdinalIgnoreCase);
            if (!enabled)
                throw new InvalidOperationException("Full GRN posting is disabled. Sage stock and AP must be posted together.");

            var allowUatBatchWrites = string.Equals(
                Environment.GetEnvironmentVariable("HYPER_SAGE_ALLOW_UAT_BATCH_WRITES"),
                "true",
                StringComparison.OrdinalIgnoreCase);
            var environment = Environment.GetEnvironmentVariable("HYPER_SAGE_ENVIRONMENT");
            if (allowUatBatchWrites && string.Equals(environment, "UAT", StringComparison.OrdinalIgnoreCase))
                return;

            var allowProductionGrnWrites = string.Equals(
                Environment.GetEnvironmentVariable("HYPER_SAGE_PRODUCTION_GRN_WRITES"),
                "true",
                StringComparison.OrdinalIgnoreCase);
            if (allowProductionGrnWrites && string.Equals(environment, "Production", StringComparison.OrdinalIgnoreCase))
                return;

            var allowedReferences = (Environment.GetEnvironmentVariable("HYPER_SAGE_ALLOWED_GRN_REFERENCES") ?? "")
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(value => value.Trim());
            if (!allowedReferences.Contains(request.Reference.Trim(), StringComparer.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "This GRN is not in the explicit posting allow-list for the configured Sage environment.");
            }
        }

        private static SageCheckpoint FindSageCheckpoint(GoodsReceiptRequest request)
        {
            using (var connection = new SqlConnection(GetCompanyConnectionString()))
            using (var command = new SqlCommand(@"
                SELECT TOP 1
                    NULLIF(document.OrderNum, '') AS OrderNumber,
                    COALESCE(NULLIF(document.GrvNumber, ''), NULLIF(document.InvNumber, '')) AS GrvNumber,
                    invoice.InvNumber AS SupplierInvoiceNumber,
                    CASE WHEN EXISTS (
                        SELECT 1
                        FROM dbo.PostAP AS ap
                        WHERE ap.InvNumKey = invoice.AutoIndex
                    ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS SupplierInvoicePosted
                FROM dbo.InvNum AS document
                OUTER APPLY (
                    SELECT TOP 1 invoiceDocument.AutoIndex, invoiceDocument.InvNumber
                    FROM dbo.InvNum AS invoiceDocument
                    WHERE invoiceDocument.ExtOrderNum = @Reference
                    ORDER BY invoiceDocument.AutoIndex DESC
                ) AS invoice
                WHERE document.ExtOrderNum = @Reference
                ORDER BY document.AutoIndex DESC;", connection))
            {
                command.Parameters.Add("@Reference", SqlDbType.VarChar, 50).Value = request.Reference.Trim();
                connection.Open();
                using (var reader = command.ExecuteReader())
                {
                    if (!reader.Read()) return SageCheckpoint.Empty;
                    return new SageCheckpoint
                    {
                        OrderNumber = reader["OrderNumber"] as string,
                        GrvNumber = reader["GrvNumber"] as string,
                        SupplierInvoiceNumber = reader["SupplierInvoiceNumber"] as string,
                        SupplierInvoicePosted = Convert.ToBoolean(reader["SupplierInvoicePosted"])
                    };
                }
            }
        }

        private static void ThrowIfSimulatedApInterruption(GoodsReceiptRequest request, string grvNumber)
        {
            var configuredReference = Environment.GetEnvironmentVariable(
                "HYPER_SAGE_SIMULATE_AP_INTERRUPTION_FOR_REFERENCE");
            if (string.Equals(configuredReference, request.Reference.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "UAT test interruption after GRV " + grvNumber + ". Restart without the simulation switch and retry this same GRN to verify invoice resume without another stock receipt.");
            }
        }

        private sealed class SageCheckpoint
        {
            public static readonly SageCheckpoint Empty = new SageCheckpoint();
            public string OrderNumber { get; set; }
            public string GrvNumber { get; set; }
            public string SupplierInvoiceNumber { get; set; }
            public bool SupplierInvoicePosted { get; set; }
        }

        private static string CompleteSupplierInvoice(
            string orderNumber,
            string grvNumber,
            GoodsReceiptRequest request)
        {
            var receivedOrder = new PurchaseOrder(orderNumber, grvNumber);
            foreach (OrderDetail detail in receivedOrder.Detail)
            {
                detail.ToProcess = detail.Quantity;
            }

            var invoiceReference = Trim(
                FirstNonBlank(request.SupplierInvoiceNo, request.ExternalReference, request.Reference),
                50);
            return receivedOrder.Process(invoiceReference);
        }

        private static PurchaseOrder PrepareGoodsReceivedVoucherWithReconnect(GoodsReceiptRequest request)
        {
            try
            {
                return PrepareGoodsReceivedVoucher(request);
            }
            catch (EvolutionException ex) when (SdkSession.IsRecoverableConnectionError(ex))
            {
                // No GRV has been posted while the document is being prepared, so one
                // reconnect and preparation retry is safe.
                SdkSession.Reconnect();
                return PrepareGoodsReceivedVoucher(request);
            }
        }

        private static PurchaseOrder PrepareGoodsReceivedVoucher(GoodsReceiptRequest request)
        {
            var txDate = request.ReceivedDate == default(DateTime)
                ? DateTime.Today
                : request.ReceivedDate.Date;

            var purchaseOrder = new PurchaseOrder
            {
                Supplier = new Supplier(request.SupplierCode.Trim()),
                OrderDate = txDate,
                InvoiceDate = txDate,
                DeliveryDate = txDate,
                DueDate = txDate,
                Description = "MES Goods Received Voucher",
                ExternalOrderNo = Trim(request.Reference, 50),
                SupplierInvoiceNo = Trim(FirstNonBlank(request.SupplierInvoiceNo, request.Reference), 50),
                MessageLine1 = Trim("MES GRN " + request.Reference, 50),
                MessageLine2 = Trim(request.SupplierDeliveryNoteNo, 50),
                MessageLine3 = Trim(request.ExternalReference, 50),
                TaxMode = SageTaxMode(request.VatMode),
                TaxType = SageTaxType(request)
            };

            foreach (var line in request.Lines)
            {
                var item = new InventoryItem(line.ItemCode.Trim().ToUpperInvariant());
                var warehouseCode = FirstNonBlank(line.Warehouse, request.Warehouse, "RM")
                    .Trim()
                    .ToUpperInvariant();
                var detail = purchaseOrder.Detail.Add(
                    item,
                    warehouseCode,
                    (double)line.Quantity,
                    (double)line.UnitCost);

                detail.Warehouse = new Warehouse(warehouseCode);
                detail.Quantity = (double)line.Quantity;
                detail.ToProcess = (double)line.Quantity;
                detail.UnitCostPrice = (double)line.UnitCost;
                detail.Note = Trim(FirstNonBlank(line.LotNumber, request.Reference), 255);
                detail.TaxMode = SageTaxMode(request.VatMode);
                detail.TaxType = SageTaxType(request);
            }

            return purchaseOrder;
        }

        private static void ValidateSageMastersWithReconnect(GoodsReceiptRequest request)
        {
            try
            {
                ValidateSageMasters(request);
            }
            catch (EvolutionException ex) when (SdkSession.IsRecoverableConnectionError(ex))
            {
                // Master validation is read-only, so reconnecting and validating once
                // more cannot create a duplicate GRV.
                SdkSession.Reconnect();
                ValidateSageMasters(request);
            }
        }

        private static void ValidateSageMasters(GoodsReceiptRequest request)
        {
            new Supplier(request.SupplierCode.Trim());
            new Warehouse(FirstNonBlank(request.Warehouse, "RM").Trim().ToUpperInvariant());

            foreach (var line in request.Lines)
            {
                new InventoryItem(line.ItemCode.Trim().ToUpperInvariant());
                new Warehouse(FirstNonBlank(line.Warehouse, request.Warehouse, "RM").Trim().ToUpperInvariant());
            }
        }

        private static string ValidateRequest(GoodsReceiptRequest request)
        {
            if (request == null)
                return "A JSON goods-receipt request is required.";

            if (string.IsNullOrWhiteSpace(request.Reference))
                return "Reference is required.";

            if (string.IsNullOrWhiteSpace(request.SupplierCode))
                return "SupplierCode is required.";

            if (request.Lines == null || request.Lines.Length == 0)
                return "At least one goods-receipt line is required.";

            if (request.VatMode != "exclusive" && request.VatMode != "inclusive" &&
                request.VatMode != "no_vat" && request.VatMode != "zero_rated")
                return "Finance VAT review is required before Sage posting.";

            if (request.VatMode != "no_vat" && (!request.VatTaxTypeId.HasValue || request.VatTaxTypeId.Value <= 0))
                return "A Sage VAT tax type is required for taxable GRNs.";

            for (var i = 0; i < request.Lines.Length; i++)
            {
                var line = request.Lines[i];
                if (line == null)
                    return "Line " + (i + 1) + " is empty.";

                if (string.IsNullOrWhiteSpace(line.ItemCode))
                    return "Line " + (i + 1) + " ItemCode is required.";

                if (line.Quantity <= 0)
                    return "Line " + (i + 1) + " Quantity must be greater than zero.";

                if (line.UnitCost < 0)
                    return "Line " + (i + 1) + " UnitCost cannot be negative.";
            }

            return null;
        }

        private static TaxMode SageTaxMode(string vatMode)
        {
            return string.Equals(vatMode, "inclusive", StringComparison.OrdinalIgnoreCase)
                ? TaxMode.Inclusive
                : TaxMode.Exclusive;
        }

        private static TaxRate SageTaxType(GoodsReceiptRequest request)
        {
            if (string.Equals(request.VatMode, "no_vat", StringComparison.OrdinalIgnoreCase))
            {
                var configuredId = Environment.GetEnvironmentVariable("HYPER_SAGE_NO_VAT_TAX_TYPE_ID");
                int noVatTaxTypeId;
                if (request.VatTaxTypeId.HasValue && request.VatTaxTypeId.Value > 0)
                    noVatTaxTypeId = request.VatTaxTypeId.Value;
                else if (!int.TryParse(configuredId, out noVatTaxTypeId) || noVatTaxTypeId <= 0)
                    throw new InvalidOperationException(
                        "No-VAT GRN posting is blocked until a Sage exempt tax type is configured.");

                var noVatTaxType = new TaxRate(noVatTaxTypeId);
                if (Math.Abs((decimal)noVatTaxType.Rate) > 0.0001m)
                    throw new InvalidOperationException(
                        "The configured no-VAT Sage tax type does not have a zero tax rate.");

                return noVatTaxType;
            }

            var taxType = new TaxRate(request.VatTaxTypeId.Value);
            if (!string.IsNullOrWhiteSpace(request.VatCode) &&
                !string.Equals(taxType.Code, request.VatCode.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "The configured Sage tax type does not match the PlantControl VAT code.");
            }

            if (request.VatRate.HasValue &&
                Math.Abs((decimal)taxType.Rate - request.VatRate.Value) > 0.0001m)
            {
                throw new InvalidOperationException(
                    "The configured Sage tax type does not match the PlantControl VAT rate.");
            }

            return taxType;
        }

        private static string GetCompanyConnectionString()
        {
            var builder = new SqlConnectionStringBuilder
            {
                DataSource = GetRequiredSetting("HYPER_SAGE_COMPANY_SERVER"),
                InitialCatalog = GetRequiredSetting("HYPER_SAGE_COMPANY_DATABASE"),
                UserID = GetRequiredSetting("HYPER_SAGE_SQL_USERNAME"),
                Password = GetRequiredSetting("HYPER_SAGE_SQL_PASSWORD"),
                ConnectTimeout = 30,
                TrustServerCertificate = true
            };
            return builder.ConnectionString;
        }

        private static string GetRequiredSetting(string name)
        {
            var value = Environment.GetEnvironmentVariable(name);
            if (string.IsNullOrWhiteSpace(value))
                throw new InvalidOperationException("Missing Windows environment variable: " + name);
            return value;
        }

        private static object GoodsReceiptSummary(GoodsReceiptRequest request, string grvNumber)
        {
            return new
            {
                reference = request.Reference.Trim(),
                grvNumber = grvNumber,
                supplierCode = request.SupplierCode.Trim(),
                supplierName = request.SupplierName,
                supplierInvoiceNo = request.SupplierInvoiceNo,
                supplierDeliveryNoteNo = request.SupplierDeliveryNoteNo,
                supplierOrderNo = request.SupplierOrderNo,
                externalReference = request.ExternalReference,
                warehouse = FirstNonBlank(request.Warehouse, "RM").Trim().ToUpperInvariant(),
                receivedDate = request.ReceivedDate,
                lineCount = request.Lines == null ? 0 : request.Lines.Length,
                totalQuantity = request.Lines == null ? 0 : request.Lines.Sum(line => line.Quantity),
                lines = request.Lines
            };
        }

        private static string FirstNonBlank(params string[] values)
        {
            foreach (var value in values)
            {
                if (!string.IsNullOrWhiteSpace(value))
                    return value;
            }
            return "";
        }

        private static string Trim(string value, int length)
        {
            if (string.IsNullOrWhiteSpace(value))
                return "";
            value = value.Trim();
            return value.Length <= length ? value : value.Substring(0, length);
        }
    }
}
