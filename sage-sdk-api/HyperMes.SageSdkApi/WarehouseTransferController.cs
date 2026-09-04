using Pastel.Evolution;
using System;
using System.Collections.Concurrent;
using System.Net;
using System.Web.Http;

namespace SDK_Test
{
    [RoutePrefix("api/v1/warehouse-transfers")]
    public class WarehouseTransferController : ApiController
    {
        private static readonly ConcurrentDictionary<string, bool> PostedReferences =
            new ConcurrentDictionary<string, bool>(
                StringComparer.OrdinalIgnoreCase);

        [HttpPost]
        [Route("validate")]
        public IHttpActionResult ValidateTransfer(WarehouseTransferRequest request)
        {
            var error = ValidateRequest(request);

            if (error != null)
                return BadRequest(error);

            try
            {
                ValidateAgainstSage(request);
            }
            catch (Exception initialException)
            {
                try
                {
                    // Validation does not post, so reconnecting and retrying once is safe
                    // when Evolution has discarded its static database context.
                    lock (SdkSession.OperationLock)
                    {
                        SdkSession.Reconnect();
                    }
                    ValidateAgainstSage(request);
                }
                catch (Exception retryException)
                {
                    return Content(HttpStatusCode.BadRequest, new
                    {
                        status = "failed",
                        environment = "UAT",
                        action = "warehouse-transfer-validation",
                        message = "Sage UAT could not validate this warehouse transfer.",
                        exceptionMessage = retryException.Message,
                        initialExceptionMessage = initialException.Message
                    });
                }
            }

            return Ok(new
            {
                status = "validated",
                environment = "UAT",
                action = "warehouse-transfer",
                sageConnection = "verified",
                sagePosting = "not performed",
                message = "Validated against Sage UAT. No Sage transfer was created.",
                transfer = TransferSummary(request)
            });
        }

        [HttpPost]
        [Route("post")]
        public IHttpActionResult PostTransfer(WarehouseTransferRequest request)
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
                lock (SdkSession.OperationLock)
                {
                    SdkSession.EnsureConnected();
                    var transfer = PrepareTransferWithReconnect(request, reference);
                    transfer.Post();
                }

                return Ok(new
                {
                    status = "posted",
                    environment = "UAT",
                    action = "warehouse-transfer",
                    sagePosting = "completed",
                    message = "Warehouse transfer posted to Sage UAT.",
                    transfer = TransferSummary(request)
                });
            }
            catch (Exception ex)
            {
                bool removed;
                PostedReferences.TryRemove(reference, out removed);

                return Content(HttpStatusCode.InternalServerError, new
                {
                    status = "failed",
                    environment = "UAT",
                    action = "warehouse-transfer",
                    message = "Sage UAT could not post this warehouse transfer.",
                    exception = ex.GetType().FullName,
                    exceptionMessage = ex.Message
                });
            }
        }

        private static string ValidateRequest(WarehouseTransferRequest request)
        {
            if (request == null)
                return "A JSON warehouse-transfer request is required.";

            if (string.IsNullOrWhiteSpace(request.ItemCode))
                return "ItemCode is required.";

            if (string.IsNullOrWhiteSpace(request.FromWarehouse))
                return "FromWarehouse is required.";

            if (string.IsNullOrWhiteSpace(request.ToWarehouse))
                return "ToWarehouse is required.";

            if (request.FromWarehouse.Trim()
                .Equals(request.ToWarehouse.Trim(),
                    StringComparison.OrdinalIgnoreCase))
            {
                return "FromWarehouse and ToWarehouse must be different.";
            }

            if (request.Quantity <= 0)
                return "Quantity must be greater than zero.";

            if (string.IsNullOrWhiteSpace(request.Reference))
                return "Reference is required.";

            return null;
        }

        private static void ValidateAgainstSage(WarehouseTransferRequest request)
        {
            lock (SdkSession.OperationLock)
            {
                SdkSession.EnsureConnected();
                new InventoryItem(request.ItemCode.Trim().ToUpperInvariant());
                new Warehouse(request.FromWarehouse.Trim().ToUpperInvariant());
                new Warehouse(request.ToWarehouse.Trim().ToUpperInvariant());
            }
        }

        private static WarehouseTransfer PrepareTransferWithReconnect(WarehouseTransferRequest request, string reference)
        {
            try
            {
                return CreateTransfer(request, reference);
            }
            catch (EvolutionException ex) when (SdkSession.IsRecoverableConnectionError(ex))
            {
                // Object construction only reads Sage master data. Reconnect and retrying
                // here is safe because transfer.Post() has not been reached yet.
                SdkSession.Reconnect();
                return CreateTransfer(request, reference);
            }
        }

        private static WarehouseTransfer CreateTransfer(WarehouseTransferRequest request, string reference)
        {
            return new WarehouseTransfer
            {
                Account = new InventoryItem(request.ItemCode.Trim().ToUpperInvariant()),
                FromWarehouse = new Warehouse(request.FromWarehouse.Trim().ToUpperInvariant()),
                ToWarehouse = new Warehouse(request.ToWarehouse.Trim().ToUpperInvariant()),
                Quantity = (double)request.Quantity,
                Reference = reference,
                Reference2 = request.Reference2 ?? ""
            };
        }

        private static object TransferSummary(WarehouseTransferRequest request)
        {
            return new
            {
                itemCode = request.ItemCode.Trim().ToUpperInvariant(),
                fromWarehouse =
                    request.FromWarehouse.Trim().ToUpperInvariant(),
                toWarehouse =
                    request.ToWarehouse.Trim().ToUpperInvariant(),
                quantity = request.Quantity,
                reference = request.Reference.Trim(),
                reference2 = request.Reference2
            };
        }
    }
}
