using Pastel.Evolution;
using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Net;
using System.Web.Http;

namespace SDK_Test
{
    [RoutePrefix("api/v1/supplier-returns")]
    public class SupplierReturnController : ApiController
    {
        private static readonly ConcurrentDictionary<string, bool> PostedReferences =
            new ConcurrentDictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

        [HttpPost]
        [Route("validate")]
        public IHttpActionResult ValidateSupplierReturn(SupplierReturnRequest request)
        {
            var error = ValidateRequest(request);
            if (error != null) return BadRequest(error);

            lock (SdkSession.OperationLock)
            {
                SdkSession.EnsureConnected();
                var rts = new ReturnToSupplier(request.OriginalGrvNumber.Trim());
                if (rts.Supplier == null) throw new InvalidOperationException("The original Sage GRV supplier could not be loaded.");
            }

            return Ok(new
            {
                status = "validated",
                action = "supplier-return",
                sagePosting = "not performed",
                originalGrvNumber = request.OriginalGrvNumber.Trim(),
                message = "Validated against Sage. No RTS was created."
            });
        }

        [HttpPost]
        [Route("post")]
        public IHttpActionResult PostSupplierReturn(SupplierReturnRequest request)
        {
            var error = ValidateRequest(request);
            if (error != null) return BadRequest(error);
            if (!request.ConfirmPost) return BadRequest("Posting is blocked. Set confirmPost to true only after approval.");

            var reference = request.Reference.Trim();
            if (!PostedReferences.TryAdd(reference, true)) return StatusCode(HttpStatusCode.Conflict);

            try
            {
                string rtsNumber;
                lock (SdkSession.OperationLock)
                {
                    SdkSession.EnsureConnected();
                    var rts = new ReturnToSupplier(request.OriginalGrvNumber.Trim());
                    if (rts.Supplier == null) throw new InvalidOperationException("The original Sage GRV supplier could not be loaded.");
                    rts.Description = (request.Reason ?? "Supplier return").Trim();
                    rts.InvoiceDate = request.ReturnDate == default(DateTime) ? DateTime.Today : request.ReturnDate;
                    while (rts.Detail.Count > 0) rts.Detail.RemoveAt(0);

                    foreach (var line in request.Lines)
                    {
                        rts.Detail.Add(line.ItemCode.Trim(), (double)line.Quantity, (double)line.UnitCost);
                    }

                    rtsNumber = rts.Process();
                }

                return Ok(new
                {
                    status = "posted",
                    action = "supplier-return",
                    sagePosting = "completed",
                    rtsNumber = rtsNumber,
                    originalGrvNumber = request.OriginalGrvNumber.Trim(),
                    message = "Return to Supplier posted to Sage."
                });
            }
            catch (Exception ex)
            {
                bool removed;
                PostedReferences.TryRemove(reference, out removed);
                return Content(HttpStatusCode.InternalServerError, new
                {
                    status = "failed",
                    action = "supplier-return",
                    message = "Sage could not post the Return to Supplier.",
                    exception = ex.GetType().FullName,
                    exceptionMessage = ex.Message,
                    detail = ex.ToString()
                });
            }
        }

        private static string ValidateRequest(SupplierReturnRequest request)
        {
            if (request == null) return "A supplier-return request is required.";
            if (string.IsNullOrWhiteSpace(request.Reference)) return "Reference is required.";
            if (string.IsNullOrWhiteSpace(request.OriginalGrvNumber)) return "OriginalGrvNumber is required.";
            if (request.Lines == null || request.Lines.Length == 0) return "At least one return line is required.";
            if (request.Lines.Any(line => line == null || string.IsNullOrWhiteSpace(line.ItemCode) || line.Quantity <= 0 || line.UnitCost < 0))
                return "Every return line requires an item code, positive quantity, and non-negative unit cost.";
            if (string.IsNullOrWhiteSpace(request.Reason)) return "Reason is required.";
            return null;
        }
    }
}
