using Pastel.Evolution;
using System;
using System.Collections.Concurrent;
using System.Net;
using System.Web.Http;

namespace SDK_Test
{
    [RoutePrefix("api/v1/finished-goods-receipts")]
    public class FinishedGoodsReceiptController : ApiController
    {
        private static readonly ConcurrentDictionary<string, bool> PostedReferences =
            new ConcurrentDictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        private static readonly object ReceiptTransactionLock = new object();

        [HttpPost]
        [Route("validate")]
        public IHttpActionResult ValidateReceipt(FinishedGoodsReceiptRequest request)
        {
            var error = ValidateRequest(request);
            if (error != null) return BadRequest(error);

            try
            {
                lock (SdkSession.OperationLock)
                {
                    SdkSession.EnsureConnected();
                    lock (ReceiptTransactionLock)
                    {
                        BeginSdkTransaction();
                        try
                        {
                            var transaction = PrepareTransactionWithReconnect(request);
                            DatabaseContext.RollbackTran();
                            return Ok(new
                            {
                                status = "validated",
                                environment = "UAT",
                                action = "finished-goods-receipt",
                                sagePosting = "not performed",
                                message = "Validated against Sage UAT. No finished-goods receipt was created.",
                                receipt = ReceiptSummary(request, transaction)
                            });
                        }
                        finally { RollbackPendingSdkTransaction(); }
                    }
                }
            }
            catch (Exception ex)
            {
                return Content(HttpStatusCode.BadRequest, new { status = "invalid", action = "finished-goods-receipt", message = ex.Message });
            }
        }

        [HttpPost]
        [Route("post")]
        public IHttpActionResult PostReceipt(FinishedGoodsReceiptRequest request)
        {
            var error = ValidateRequest(request);
            if (error != null) return BadRequest(error);
            if (!request.ConfirmPost) return BadRequest("Posting is blocked. Set confirmPost to true only after approval.");

            var reference = request.Reference.Trim();
            if (!PostedReferences.TryAdd(reference, true)) return StatusCode(HttpStatusCode.Conflict);

            try
            {
                lock (SdkSession.OperationLock)
                {
                    SdkSession.EnsureConnected();
                    lock (ReceiptTransactionLock)
                    {
                        BeginSdkTransaction();
                        try
                        {
                            var transaction = PrepareTransactionWithReconnect(request);
                            if (!transaction.Post()) throw new InvalidOperationException("Sage could not post the finished-goods receipt.");
                            if (!DatabaseContext.CommitTran()) throw new InvalidOperationException("Sage could not commit the finished-goods receipt.");

                            return Ok(new
                            {
                                status = "posted",
                                environment = "UAT",
                                action = "finished-goods-receipt",
                                postingMode = "sdk-inventory-transaction",
                                sagePosting = "completed",
                                message = "Finished-goods receipt posted to Sage UAT through the Evolution SDK.",
                                receipt = ReceiptSummary(request, transaction)
                            });
                        }
                        finally { RollbackPendingSdkTransaction(); }
                    }
                }
            }
            catch (Exception ex)
            {
                bool removed;
                PostedReferences.TryRemove(reference, out removed);
                return Content(HttpStatusCode.InternalServerError, new { status = "failed", action = "finished-goods-receipt", message = "Sage UAT could not post the finished-goods receipt.", exceptionMessage = ex.Message });
            }
        }

        private static InventoryTransaction PrepareTransaction(FinishedGoodsReceiptRequest request)
        {
            var item = new InventoryItem(request.ItemCode.Trim().ToUpperInvariant());
            var warehouse = new Warehouse(request.Warehouse.Trim().ToUpperInvariant());
            var transaction = new InventoryTransaction
            {
                InventoryItem = item,
                Warehouse = warehouse,
                TransactionCode = new TransactionCode(Module.Inventory, "MFMF"),
                Operation = InventoryOperation.Increase,
                Quantity = (double)request.Quantity,
                UnitCost = (double)request.UnitCost,
                Date = request.ReceiptDate == default(DateTime) ? DateTime.Today : request.ReceiptDate.Date,
                Reference = request.Reference.Trim(),
                Reference2 = request.Reference2 ?? "",
                Description = string.IsNullOrWhiteSpace(request.Description) ? "Finished goods manufacture" : request.Description.Trim(),
                PostToGL = true
            };
            if (!transaction.Validate()) throw new InvalidOperationException("Sage rejected finished-goods receipt validation for " + item.Code + ".");
            return transaction;
        }

        private static InventoryTransaction PrepareTransactionWithReconnect(FinishedGoodsReceiptRequest request)
        {
            try
            {
                return PrepareTransaction(request);
            }
            catch (Exception ex) when (SdkSession.IsRecoverableConnectionError(ex))
            {
                // This occurs before InventoryTransaction.Post(), so a single reconnect
                // and preparation retry cannot duplicate a finished-goods receipt.
                RollbackPendingSdkTransaction();
                SdkSession.Reconnect();
                BeginSdkTransaction();
                return PrepareTransaction(request);
            }
        }

        private static string ValidateRequest(FinishedGoodsReceiptRequest request)
        {
            if (request == null) return "A JSON finished-goods receipt request is required.";
            if (string.IsNullOrWhiteSpace(request.Reference)) return "Reference is required.";
            if (string.IsNullOrWhiteSpace(request.ItemCode)) return "ItemCode is required.";
            if (string.IsNullOrWhiteSpace(request.Warehouse)) return "Warehouse is required.";
            if (request.Quantity <= 0) return "Quantity must be greater than zero.";
            if (request.UnitCost < 0) return "UnitCost cannot be negative.";
            return null;
        }

        private static void BeginSdkTransaction()
        {
            try
            {
                if (!DatabaseContext.BeginTran()) throw new InvalidOperationException("Sage could not start the finished-goods receipt transaction.");
            }
            catch (EvolutionException ex) when (SdkSession.IsRecoverableConnectionError(ex))
            {
                // The transaction has not started, so one reconnect/retry is safe.
                SdkSession.Reconnect();
                if (!DatabaseContext.BeginTran()) throw new InvalidOperationException("Sage could not start the finished-goods receipt transaction after reconnecting.");
            }
        }

        private static void RollbackPendingSdkTransaction()
        {
            if (DatabaseContext.IsTransactionPending) DatabaseContext.RollbackTran();
        }

        private static object ReceiptSummary(FinishedGoodsReceiptRequest request, InventoryTransaction transaction)
        {
            return new
            {
                reference = request.Reference.Trim(),
                reference2 = request.Reference2,
                itemCode = request.ItemCode.Trim().ToUpperInvariant(),
                warehouse = request.Warehouse.Trim().ToUpperInvariant(),
                transactionCode = "MFMF",
                quantity = request.Quantity,
                unitCost = request.UnitCost,
                receiptDate = transaction.Date
            };
        }
    }
}
