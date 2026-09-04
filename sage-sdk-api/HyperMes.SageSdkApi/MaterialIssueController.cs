using Pastel.Evolution;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Web.Http;

namespace SDK_Test
{
    [RoutePrefix("api/v1/material-issues")]
    public class MaterialIssueController : ApiController
    {
        private static readonly ConcurrentDictionary<string, bool> PostedReferences =
            new ConcurrentDictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        private static readonly object IssueTransactionLock = new object();

        [HttpPost]
        [Route("validate")]
        public IHttpActionResult ValidateMaterialIssue(MaterialIssueRequest request)
        {
            var error = ValidateRequest(request);
            if (error != null)
                return BadRequest(error);

            try
            {
                lock (SdkSession.OperationLock)
                {
                    SdkSession.EnsureConnected();
                    lock (IssueTransactionLock)
                    {
                        BeginSdkTransaction();
                        try
                        {
                            var preparedLines = PrepareTransactionsWithReconnect(request);
                            DatabaseContext.RollbackTran();
                            return Ok(new
                            {
                                status = "validated",
                                environment = "UAT",
                                action = "material-issue",
                                sageConnection = "verified",
                                sagePosting = "not performed",
                                message = "Validated against Sage UAT. No material issue was posted.",
                                materialIssue = IssueSummary(request, preparedLines)
                            });
                        }
                        finally
                        {
                            RollbackPendingSdkTransaction();
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                return Content(HttpStatusCode.BadRequest, new
                {
                    status = "invalid",
                    action = "material-issue",
                    message = ex.Message
                });
            }
        }

        [HttpPost]
        [Route("post")]
        public IHttpActionResult PostMaterialIssue(MaterialIssueRequest request)
        {
            var error = ValidateRequest(request);
            if (error != null)
                return BadRequest(error);
            if (!request.ConfirmPost)
                return BadRequest("Posting is blocked. Set confirmPost to true only after approval.");

            var reference = request.Reference.Trim();
            if (!PostedReferences.TryAdd(reference, true))
                return StatusCode(HttpStatusCode.Conflict);

            try
            {
                lock (SdkSession.OperationLock)
                {
                    SdkSession.EnsureConnected();
                    lock (IssueTransactionLock)
                    {
                        BeginSdkTransaction();
                        try
                        {
                            var preparedLines = PrepareTransactionsWithReconnect(request);
                            foreach (var line in preparedLines)
                            {
                                if (!line.Transaction.Post())
                                    throw new InvalidOperationException("Sage could not post material issue line " + line.ItemCode + ".");
                            }
                            if (!DatabaseContext.CommitTran())
                                throw new InvalidOperationException("Sage could not commit the material issue transaction.");

                            return Ok(new
                            {
                                status = "posted",
                                environment = "UAT",
                                action = "material-issue",
                                postingMode = "sdk-inventory-transaction",
                                sagePosting = "completed",
                                message = "Material issue posted to Sage UAT through the Evolution SDK.",
                                materialIssue = IssueSummary(request, preparedLines)
                            });
                        }
                        finally
                        {
                            RollbackPendingSdkTransaction();
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                bool removed;
                PostedReferences.TryRemove(reference, out removed);
                return Content(HttpStatusCode.InternalServerError, new
                {
                    status = "failed",
                    environment = "UAT",
                    action = "material-issue",
                    message = "Sage UAT could not post this material issue.",
                    exception = ex.GetType().FullName,
                    exceptionMessage = ex.Message
                });
            }
        }

        private static List<PreparedIssueLine> PrepareTransactions(MaterialIssueRequest request)
        {
            var warehouse = new Warehouse(request.Warehouse.Trim().ToUpperInvariant());
            var transactionCode = new TransactionCode(Module.Inventory, GetTransactionCode(request));
            var issueDate = request.IssueDate == default(DateTime) ? DateTime.Today : request.IssueDate.Date;
            var preparedLines = new List<PreparedIssueLine>();

            foreach (var line in request.Lines)
            {
                var item = new InventoryItem(line.ItemCode.Trim().ToUpperInvariant());
                var context = item.WarehouseContexts[warehouse];
                if (context == null)
                    throw new InvalidOperationException("Sage has no warehouse context for " + item.Code + " in " + warehouse.Code + ".");
                if (context.QtyOnHand < (double)line.Quantity)
                    throw new InvalidOperationException("Insufficient Sage stock for " + item.Code + " in " + warehouse.Code + ": " + context.QtyOnHand + " available, " + line.Quantity + " requested.");

                var transaction = new InventoryTransaction
                {
                    InventoryItem = item,
                    Warehouse = warehouse,
                    TransactionCode = transactionCode,
                    Operation = InventoryOperation.Decrease,
                    Quantity = (double)line.Quantity,
                    UnitCost = context.AverageUnitCost,
                    Date = issueDate,
                    Reference = request.Reference.Trim(),
                    Reference2 = request.Reference2 ?? "",
                    Description = FirstNonBlank(line.Description, "Material issue").Trim(),
                    PostToGL = true
                };

                if (!transaction.Validate())
                    throw new InvalidOperationException("Sage rejected material issue validation for " + item.Code + ".");

                preparedLines.Add(new PreparedIssueLine
                {
                    ItemCode = item.Code,
                    Quantity = line.Quantity,
                    AvailableQuantity = context.QtyOnHand,
                    SageAverageUnitCost = context.AverageUnitCost,
                    Transaction = transaction
                });
            }
            return preparedLines;
        }

        private static List<PreparedIssueLine> PrepareTransactionsWithReconnect(MaterialIssueRequest request)
        {
            try
            {
                return PrepareTransactions(request);
            }
            catch (Exception ex) when (SdkSession.IsRecoverableConnectionError(ex))
            {
                // Validation/setup has not posted any inventory transaction. Reset the
                // abandoned SDK transaction, reconnect, then prepare once more.
                RollbackPendingSdkTransaction();
                SdkSession.Reconnect();
                BeginSdkTransaction();
                return PrepareTransactions(request);
            }
        }

        private static string ValidateRequest(MaterialIssueRequest request)
        {
            if (request == null) return "A JSON material-issue request is required.";
            if (string.IsNullOrWhiteSpace(request.Reference)) return "Reference is required.";
            if (string.IsNullOrWhiteSpace(request.Warehouse)) return "Warehouse is required.";
            if (request.Lines == null || request.Lines.Length == 0) return "At least one material-issue line is required.";
            foreach (var line in request.Lines)
            {
                if (line == null || string.IsNullOrWhiteSpace(line.ItemCode)) return "Every material-issue line requires ItemCode.";
                if (line.Quantity <= 0) return "Every material-issue quantity must be greater than zero.";
            }
            return null;
        }

        private static void BeginSdkTransaction()
        {
            try
            {
                if (!DatabaseContext.BeginTran())
                    throw new InvalidOperationException("Sage could not start the material issue transaction.");
            }
            catch (EvolutionException ex) when (SdkSession.IsRecoverableConnectionError(ex))
            {
                // The transaction has not started, so one reconnect/retry is safe.
                SdkSession.Reconnect();
                if (!DatabaseContext.BeginTran())
                    throw new InvalidOperationException("Sage could not start the material issue transaction after reconnecting.");
            }
        }

        private static void RollbackPendingSdkTransaction()
        {
            if (DatabaseContext.IsTransactionPending)
                DatabaseContext.RollbackTran();
        }

        private static string GetTransactionCode(MaterialIssueRequest request)
        {
            var transactionCode = string.IsNullOrWhiteSpace(request.TransactionCode) ? "MFDR" : request.TransactionCode.Trim().ToUpperInvariant();
            if (!string.Equals(transactionCode, "MFDR", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Material issues must use Sage transaction code MFDR.");
            return transactionCode;
        }

        private static object IssueSummary(MaterialIssueRequest request, IEnumerable<PreparedIssueLine> preparedLines)
        {
            return new
            {
                reference = request.Reference.Trim(),
                reference2 = request.Reference2,
                warehouse = request.Warehouse.Trim().ToUpperInvariant(),
                transactionCode = GetTransactionCode(request),
                issueDate = request.IssueDate == default(DateTime) ? DateTime.Today : request.IssueDate.Date,
                lineCount = preparedLines.Count(),
                totalQuantity = preparedLines.Sum(line => line.Quantity),
                lines = preparedLines.Select(line => new { itemCode = line.ItemCode, quantity = line.Quantity, availableQuantity = line.AvailableQuantity, sageAverageUnitCost = line.SageAverageUnitCost })
            };
        }

        private static string FirstNonBlank(params string[] values)
        {
            foreach (var value in values)
                if (!string.IsNullOrWhiteSpace(value)) return value;
            return "";
        }

        private sealed class PreparedIssueLine
        {
            public string ItemCode { get; set; }
            public decimal Quantity { get; set; }
            public double AvailableQuantity { get; set; }
            public double SageAverageUnitCost { get; set; }
            public InventoryTransaction Transaction { get; set; }
        }
    }
}
