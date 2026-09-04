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
        private static readonly object GrvNumberLock = new object();

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
                ValidateStandaloneGrvSupplier(request.SupplierCode);
            }

            return Ok(new
            {
                status = "validated",
                environment = SageRuntime.EnvironmentName,
                action = "goods-receipt-grv",
                sageConnection = "verified",
                sagePosting = "not performed",
                message = "Validated against Sage " + SageRuntime.EnvironmentName + ". No GRV was created.",
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
            var existingGrvNumber = FindStandaloneGrvByMesReference(reference);
            if (!string.IsNullOrWhiteSpace(existingGrvNumber))
                return Ok(PostedGoodsReceiptResponse(request, existingGrvNumber, "already-posted"));

            if (!PostedReferences.TryAdd(reference, true))
            {
                existingGrvNumber = FindStandaloneGrvByMesReference(reference);
                if (!string.IsNullOrWhiteSpace(existingGrvNumber))
                    return Ok(PostedGoodsReceiptResponse(request, existingGrvNumber, "already-posted"));

                return StatusCode(System.Net.HttpStatusCode.Conflict);
            }

            SqlConnection referenceLockConnection = null;
            try
            {
                // This SQL application lock protects the MES GRN reference across API processes.
                referenceLockConnection = AcquireGrvReferenceLock(reference);
                existingGrvNumber = FindStandaloneGrvByMesReference(reference);
                if (!string.IsNullOrWhiteSpace(existingGrvNumber))
                    return Ok(PostedGoodsReceiptResponse(request, existingGrvNumber, "already-posted"));

                lock (SdkSession.OperationLock)
                {
                    SdkSession.EnsureConnected();
                    ValidateSageMastersWithReconnect(request);
                    ValidateStandaloneGrvSupplier(request.SupplierCode);

                    string grvNumber;
                    lock (GrvNumberLock)
                    {
                        grvNumber = GetNextSageGrvNumber();
                        PostStandaloneGoodsReceivedVoucher(request, grvNumber);
                        AdvanceSageGrvSequence(grvNumber);
                    }

                    return Ok(PostedGoodsReceiptResponse(request, grvNumber, "posted"));
                }
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
                    message = "Sage " + SageRuntime.EnvironmentName + " could not post this goods receipt GRV.",
                    exception = ex.GetType().FullName,
                    exceptionMessage = ex.Message,
                    detail = ex.ToString()
                });
            }
            finally
            {
                ReleaseGrvReferenceLock(referenceLockConnection, reference);
            }
        }

        private static object PostedGoodsReceiptResponse(GoodsReceiptRequest request, string grvNumber, string status)
        {
            var alreadyPosted = string.Equals(status, "already-posted", StringComparison.OrdinalIgnoreCase);
            return new
            {
                status = status,
                environment = SageRuntime.EnvironmentName,
                action = "goods-receipt-grv",
                postingMode = "legacy-standalone-grv",
                sagePosting = "completed",
                grvNumber = grvNumber,
                documentNumber = grvNumber,
                message = alreadyPosted
                    ? "Sage " + SageRuntime.EnvironmentName + " already contains this standalone GRV; returning the existing posting."
                    : "Goods receipt posted to Sage " + SageRuntime.EnvironmentName + " as a standalone GRV.",
                goodsReceipt = GoodsReceiptSummary(request, grvNumber)
            };
        }

        private static string FindStandaloneGrvByMesReference(string mesReference)
        {
            using (var connection = new SqlConnection(GetCompanyConnectionString()))
            using (var command = new SqlCommand(@"
                SELECT TOP 1 inv.InvNumber
                FROM PostAP AS ap
                INNER JOIN InvNum AS inv ON inv.AutoIndex = ap.InvNumKey
                WHERE ap.Id = 'Grv'
                  AND ap.cReference2 = @MesReference
                  AND inv.DocType = 2
                ORDER BY ap.AutoIdx DESC;", connection))
            {
                command.Parameters.Add("@MesReference", SqlDbType.VarChar, 50).Value = mesReference;
                connection.Open();
                return command.ExecuteScalar() as string;
            }
        }

        private static SqlConnection AcquireGrvReferenceLock(string mesReference)
        {
            var connection = new SqlConnection(GetCompanyConnectionString());
            try
            {
                connection.Open();
                using (var command = new SqlCommand(@"
                    DECLARE @Result int;
                    EXEC @Result = sys.sp_getapplock
                        @Resource = @Resource,
                        @LockMode = 'Exclusive',
                        @LockOwner = 'Session',
                        @LockTimeout = 0;
                    SELECT @Result;", connection))
                {
                    command.Parameters.Add("@Resource", SqlDbType.NVarChar, 255).Value = "HYPER_MES_GRV:" + mesReference;
                    var result = Convert.ToInt32(command.ExecuteScalar());
                    if (result < 0)
                        throw new InvalidOperationException("Another Sage GRV posting is already processing for MES reference " + mesReference + ".");
                }
                return connection;
            }
            catch
            {
                connection.Dispose();
                throw;
            }
        }

        private static void ReleaseGrvReferenceLock(SqlConnection connection, string mesReference)
        {
            if (connection == null) return;
            try
            {
                using (var command = new SqlCommand("EXEC sys.sp_releaseapplock @Resource = @Resource, @LockOwner = 'Session';", connection))
                {
                    command.Parameters.Add("@Resource", SqlDbType.NVarChar, 255).Value = "HYPER_MES_GRV:" + mesReference;
                    command.ExecuteNonQuery();
                }
            }
            finally
            {
                connection.Dispose();
            }
        }

        private static string GetNextSageGrvNumber()
        {
            using (var connection = new SqlConnection(GetCompanyConnectionString()))
            using (var command = new SqlCommand(@"
                SELECT COALESCE(MAX(TRY_CONVERT(int, SUBSTRING(GrvValue, 6, 6))), 0) + 1
                FROM (
                    SELECT InvNumber AS GrvValue FROM InvNum WHERE DocType = 2 AND InvNumber LIKE 'HFGRV[0-9]%'
                    UNION ALL
                    SELECT GrvNumber AS GrvValue FROM InvNum WHERE DocType = 2 AND GrvNumber LIKE 'HFGRV[0-9]%'
                ) AS Numbers
                WHERE LEN(GrvValue) = 11
                  AND TRY_CONVERT(int, SUBSTRING(GrvValue, 6, 6)) IS NOT NULL;", connection))
            {
                connection.Open();
                var next = Convert.ToInt32(command.ExecuteScalar());
                return "HFGRV" + next.ToString("000000");
            }
        }

        private static string GetCompanyConnectionString()
        {
            var builder = new SqlConnectionStringBuilder
            {
                DataSource = GetRequiredSetting("HYPER_SAGE_SERVER"),
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

        private static void PostStandaloneGoodsReceivedVoucher(GoodsReceiptRequest request, string grvNumber)
        {
            var txDate = request.ReceivedDate == default(DateTime)
                ? DateTime.Today
                : request.ReceivedDate.Date;

            using (var connection = new SqlConnection(GetCompanyConnectionString()))
            {
                connection.Open();
                foreach (var line in request.Lines)
                {
                    using (var command = new SqlCommand("dbo.PostGRVV2", connection))
                    {
                        command.CommandType = CommandType.StoredProcedure;
                        command.CommandTimeout = 120;
                        command.Parameters.Add("@ItemCode", SqlDbType.VarChar, 50).Value = line.ItemCode.Trim().ToUpperInvariant();
                        command.Parameters.Add("@InventoryTransactionCode", SqlDbType.VarChar, 50).Value = "GRV";
                        command.Parameters.Add("@Quantity", SqlDbType.Float).Value = (double)line.Quantity;
                        command.Parameters.Add("@WHCode", SqlDbType.VarChar, 50).Value = FirstNonBlank(line.Warehouse, request.Warehouse, "RM").Trim().ToUpperInvariant();
                        command.Parameters.Add("@LotNumber", SqlDbType.VarChar, 50).Value = Trim(line.LotNumber, 50);
                        command.Parameters.Add("@UnitCost", SqlDbType.Float).Value = (double)line.UnitCost;
                        command.Parameters.Add("@ProjectID", SqlDbType.Int).Value = 0;
                        command.Parameters.Add("@TradePayablesAccountCode", SqlDbType.VarChar, 100).Value = "";
                        command.Parameters.Add("@VarianceAccountCode", SqlDbType.VarChar, 100).Value = "";
                        command.Parameters.Add("@Reference", SqlDbType.VarChar, 50).Value = grvNumber;
                        command.Parameters.Add("@Reference2", SqlDbType.VarChar, 50).Value = Trim(request.Reference, 50);
                        command.Parameters.Add("@TransactionDate", SqlDbType.DateTime).Value = txDate;
                        command.Parameters.Add("@Description", SqlDbType.VarChar, 255).Value = Trim(FirstNonBlank(line.Description, "Goods Received Voucher"), 255);
                        command.Parameters.Add("@UserName", SqlDbType.VarChar, 50).Value = "HYPER MES";
                        command.Parameters.Add("@SupplierCode", SqlDbType.VarChar, 50).Value = request.SupplierCode.Trim();
                        command.ExecuteNonQuery();
                    }
                }

                StampStandaloneGrvReferences(connection, grvNumber, request);
                StampStandaloneGrvDisplayTotals(connection, grvNumber);
                LinkStandaloneGrvStockPostings(connection, grvNumber);
            }

            ValidateStandaloneGrvDocument(grvNumber);
        }

        private static void StampStandaloneGrvDisplayTotals(SqlConnection connection, string grvNumber)
        {
            // Evolution's archived GRV view reads the last-processed fields, not just the posted fields.
            using (var command = new SqlCommand(@"
                UPDATE line
                SET
                    fQtyLastProcess = line.fQtyProcessed,
                    fQtyLastProcessLineTotIncl = line.fQtyProcessedLineTotIncl,
                    fQtyLastProcessLineTotExcl = line.fQtyProcessedLineTotExcl,
                    fQtyLastProcessLineTotInclNoDisc = line.fQtyProcessedLineTotInclNoDisc,
                    fQtyLastProcessLineTotExclNoDisc = line.fQtyProcessedLineTotExclNoDisc,
                    fQtyLastProcessLineTaxAmount = line.fQtyProcessedLineTaxAmount,
                    fQtyLastProcessLineTaxAmountNoDisc = line.fQtyProcessedLineTaxAmountNoDisc
                FROM _btblInvoiceLines AS line
                INNER JOIN InvNum AS header ON header.AutoIndex = line.iInvoiceID
                WHERE header.InvNumber = @GrvNumber OR header.GrvNumber = @GrvNumber;", connection))
            {
                command.Parameters.Add("@GrvNumber", SqlDbType.VarChar, 50).Value = grvNumber;
                command.ExecuteNonQuery();
            }
        }

        private static void StampStandaloneGrvReferences(
            SqlConnection connection,
            string grvNumber,
            GoodsReceiptRequest request)
        {
            // Evolution displays Supplier Invoice from the GRV header DeliveryNote field.
            // The legacy posting procedure owns the financial transaction; this only fills
            // its document references after a successful GRV creation.
            using (var command = new SqlCommand(@"
                UPDATE header
                SET
                    OrderNum = CASE
                        WHEN NULLIF(@SupplierOrderNo, '') IS NULL THEN header.OrderNum
                        ELSE @SupplierOrderNo
                    END,
                    DeliveryNote = CASE
                        WHEN NULLIF(@SupplierInvoiceNo, '') IS NULL THEN header.DeliveryNote
                        ELSE @SupplierInvoiceNo
                    END
                FROM InvNum AS header
                WHERE header.InvNumber = @GrvNumber OR header.GrvNumber = @GrvNumber;", connection))
            {
                command.Parameters.Add("@GrvNumber", SqlDbType.VarChar, 50).Value = grvNumber;
                command.Parameters.Add("@SupplierInvoiceNo", SqlDbType.VarChar, 50).Value = Trim(request.SupplierInvoiceNo, 50);
                command.Parameters.Add("@SupplierOrderNo", SqlDbType.VarChar, 50).Value = Trim(request.SupplierOrderNo, 50);
                command.ExecuteNonQuery();
            }
        }

        private static void LinkStandaloneGrvStockPostings(SqlConnection connection, string grvNumber)
        {
            // The legacy procedure creates posting rows before the GRV header. Reconcile
            // them to Sage's native GRV source fields once the original header exists so
            // Audit Trail can open the GRV from its stock and GL entries.
            using (var command = new SqlCommand(@"
                UPDATE stockPost
                SET InvNumKey = header.AutoIndex,
                    Id = 'Grv',
                    DrCrAccount = header.AccountID
                FROM PostST AS stockPost
                INNER JOIN InvNum AS header
                    ON header.InvNumber = @GrvNumber
                   AND header.DocType = 2
                   AND header.DocVersion = 1
                WHERE stockPost.Reference = @GrvNumber;

                UPDATE glPost
                SET Id = 'Grv',
                    DrCrAccount = header.AccountID
                FROM PostGL AS glPost
                INNER JOIN InvNum AS header
                    ON header.InvNumber = @GrvNumber
                   AND header.DocType = 2
                   AND header.DocVersion = 1
                WHERE glPost.Reference = @GrvNumber;", connection))
            {
                command.Parameters.Add("@GrvNumber", SqlDbType.VarChar, 50).Value = grvNumber;
                command.ExecuteNonQuery();
            }
        }

        private static void ValidateStandaloneGrvDocument(string grvNumber)
        {
            using (var connection = new SqlConnection(GetCompanyConnectionString()))
            using (var command = new SqlCommand(@"
                SELECT TOP 1 DocType FROM InvNum
                WHERE InvNumber = @GrvNumber OR GrvNumber = @GrvNumber
                ORDER BY CASE WHEN InvNumber = @GrvNumber THEN 0 ELSE 1 END, AutoIndex;", connection))
            {
                command.Parameters.Add("@GrvNumber", SqlDbType.VarChar, 50).Value = grvNumber;
                connection.Open();
                var docType = command.ExecuteScalar();
                if (docType == null || Convert.ToInt32(docType) != (int)DocumentType.GoodsReceivedVoucher)
                    throw new InvalidOperationException("Sage did not create standalone Goods Received Voucher " + grvNumber + ".");
            }
        }

        private static void AdvanceSageGrvSequence(string grvNumber)
        {
            var sequence = int.Parse(grvNumber.Substring(5));
            using (var connection = new SqlConnection(GetCompanyConnectionString()))
            using (var command = new SqlCommand(@"
                UPDATE StDfTbl SET GrvNum = CASE WHEN ISNULL(GrvNum, 0) < @Sequence THEN @Sequence ELSE GrvNum END;", connection))
            {
                command.Parameters.Add("@Sequence", SqlDbType.Int).Value = sequence;
                connection.Open();
                command.ExecuteNonQuery();
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

        private static void ValidateSageMastersWithReconnect(GoodsReceiptRequest request)
        {
            try
            {
                ValidateSageMasters(request);
            }
            catch (EvolutionDatabaseException ex) when (ex.Message.IndexOf("connection has not been initialised", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                // No GRV transaction has started yet, so one reconnect/retry is safe.
                SdkSession.Reconnect();
                ValidateSageMasters(request);
            }
        }

        private static void ValidateStandaloneGrvSupplier(string supplierCode)
        {
            using (var connection = new SqlConnection(GetCompanyConnectionString()))
            using (var command = new SqlCommand(@"
                SELECT TOP 1 Name
                FROM Vendor
                WHERE Account = @SupplierCode
                  AND NULLIF(LTRIM(RTRIM(Name)), '') IS NOT NULL;", connection))
            {
                command.Parameters.Add("@SupplierCode", SqlDbType.VarChar, 50).Value = supplierCode.Trim();
                connection.Open();
                var supplierName = command.ExecuteScalar() as string;
                if (string.IsNullOrWhiteSpace(supplierName))
                    throw new InvalidOperationException(
                        "Sage supplier " + supplierCode.Trim() +
                        " could not be resolved to a named Vendor. The GRV was not posted.");
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

            if (request.Lines.Length > 1)
                return "The GRV bridge currently supports one line per Sage GRV while HFGRV sequencing is being validated.";

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
