using Pastel.Evolution;
using System;
using System.Linq;
using System.Net;
using System.Web.Http;

namespace SDK_Test
{
    [RoutePrefix("api/v1/returns")]
    public class ReturnToSupplierController : ApiController
    {
        [HttpPost]
        [Route("validate")]
        public IHttpActionResult Validate([FromBody] ReturnToSupplierValidationRequest request)
        {
            var validationError = ValidateRequest(request);
            if (validationError != null)
                return BadRequest(validationError);

            try
            {
                lock (SdkSession.OperationLock)
                {
                    SdkSession.EnsureConnected();

                    var firstLine = request.Lines[0];
                    var item = new InventoryItem(firstLine.ItemCode.Trim().ToUpperInvariant());
                    var warehouse = new Warehouse(firstLine.WarehouseCode.Trim().ToUpperInvariant());
                    var supplier = new Supplier(request.SupplierCode.Trim());
                    var transactionDate = request.TransactionDate ?? DateTime.Today;

                    var returnToSupplier = new ReturnToSupplier
                    {
                        Supplier = supplier,
                        InvoiceDate = transactionDate,
                        OrderDate = transactionDate,
                        DueDate = transactionDate,
                        DeliveryDate = transactionDate,
                        Description = Trim("MES RTS " + request.OriginalGrnReference, 50),
                        ExternalOrderNo = Trim(request.ReturnReference, 50),
                        MessageLine1 = Trim("MES RTS " + request.OriginalGrnReference, 50),
                        MessageLine2 = Trim(request.Reason, 50),
                        MessageLine3 = Trim(request.OriginalGrnReference, 50)
                    };

                    var detail = returnToSupplier.Detail.Add(item, warehouse.Code, (double)firstLine.Quantity, (double)firstLine.UnitCost);

                    detail.Warehouse = warehouse;
                    detail.Quantity = (double)firstLine.Quantity;
                    detail.ToProcess = (double)firstLine.Quantity;
                    detail.UnitCostPrice = (double)firstLine.UnitCost;

                    return Ok(new
                    {
                        status = "valid",
                        environment = SageRuntime.EnvironmentName,
                        companyDatabase = SageRuntime.CompanyDatabase,
                        posted = false,
                        sageDocumentType = "ReturnToSupplier",
                        sageDocType = 3,
                        supplierAccountID = request.SupplierAccountID,
                        itemID = item.ID,
                        itemCode = item.Code,
                        itemDescription = item.Description,
                        warehouseID = warehouse.ID,
                        warehouseCode = warehouse.Code,
                        quantity = detail.Quantity,
                        unitCost = detail.UnitCostPrice,
                        originalGrnReference = request.OriginalGrnReference,
                        reason = request.Reason,
                        message = "RTS constructed in memory only. No Sage transaction was created."
                    });
                }
            }
            catch (Exception ex)
            {
                return Content(HttpStatusCode.BadRequest, new
                {
                    status = "failed",
                    posted = false,
                    message = "Sage RTS validation failed.",
                    exceptionMessage = ex.Message
                });
            }
        }

        [HttpPost]
        [Route("post")]
        public IHttpActionResult Post([FromBody] ReturnToSupplierValidationRequest request)
        {
            var validationError = ValidateRequest(request);
            if (validationError != null) return BadRequest(validationError);
            if (!request.ConfirmPost) return BadRequest("ConfirmPost must be true for a Sage RTS post.");

            try
            {
                lock (SdkSession.OperationLock)
                {
                    SdkSession.EnsureConnected();
                    var transactionDate = request.TransactionDate ?? DateTime.Today;
                    var supplier = new Supplier(request.SupplierCode.Trim());
                    var returnToSupplier = new ReturnToSupplier
                    {
                        Supplier = supplier,
                        InvoiceDate = transactionDate,
                        OrderDate = transactionDate,
                        DueDate = transactionDate,
                        DeliveryDate = transactionDate,
                        Description = Trim("MES RTS " + request.OriginalGrnReference, 50),
                        ExternalOrderNo = Trim(request.ReturnReference, 50),
                        MessageLine1 = Trim("MES RTS " + request.OriginalGrnReference, 50),
                        MessageLine2 = Trim(request.OriginalSageGrvNumber, 50),
                        MessageLine3 = Trim(request.Reason, 50)
                    };

                    foreach (var line in request.Lines)
                    {
                        var item = new InventoryItem(line.ItemCode.Trim().ToUpperInvariant());
                        var warehouse = new Warehouse(line.WarehouseCode.Trim().ToUpperInvariant());
                        var detail = returnToSupplier.Detail.Add(item, warehouse.Code, (double)line.Quantity, (double)line.UnitCost);
                        detail.Warehouse = warehouse;
                        detail.Quantity = (double)line.Quantity;
                        detail.ToProcess = (double)line.Quantity;
                        detail.UnitCostPrice = (double)line.UnitCost;
                    }

                    returnToSupplier.Process();
                    return Ok(new
                    {
                        status = "posted",
                        environment = SageRuntime.EnvironmentName,
                        companyDatabase = SageRuntime.CompanyDatabase,
                        posted = true,
                        returnReference = request.ReturnReference,
                        returnNumber = returnToSupplier.InvoiceNumber,
                        originalGrnReference = request.OriginalGrnReference,
                        originalSageGrvNumber = request.OriginalSageGrvNumber,
                        message = "Return to Supplier posted to Sage."
                    });
                }
            }
            catch (Exception ex)
            {
                return Content(HttpStatusCode.BadRequest, new { status = "failed", posted = false, message = "Sage RTS posting failed.", exceptionMessage = ex.Message });
            }
        }

        private static string ValidateRequest(ReturnToSupplierValidationRequest request)
        {
            if (request == null) return "Request body is required.";
            if (string.IsNullOrWhiteSpace(request.SupplierCode) && request.SupplierAccountID <= 0) return "SupplierCode is required.";
            if (string.IsNullOrWhiteSpace(request.ReturnReference)) return "ReturnReference is required.";
            if (request.Lines == null || request.Lines.Length == 0) return "At least one line is required.";
            if (request.Lines.Any(line => string.IsNullOrWhiteSpace(line.ItemCode) || string.IsNullOrWhiteSpace(line.WarehouseCode) || line.Quantity <= 0 || line.UnitCost < 0)) return "Every line needs an item, warehouse, positive quantity, and non-negative unit cost.";
            if (string.IsNullOrWhiteSpace(request.OriginalGrnReference)) return "OriginalGrnReference is required.";
            if (string.IsNullOrWhiteSpace(request.Reason)) return "Reason is required.";
            return null;
        }

        private static string Trim(string value, int maxLength)
        {
            if (string.IsNullOrWhiteSpace(value)) return "";
            var trimmed = value.Trim();
            return trimmed.Length <= maxLength ? trimmed : trimmed.Substring(0, maxLength);
        }
    }
}
