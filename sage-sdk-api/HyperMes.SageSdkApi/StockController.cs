using Pastel.Evolution;
using System;
using System.Net;
using System.Web.Http;

namespace SDK_Test
{
    [RoutePrefix("api/v1/stock")]
    public class StockController : ApiController
    {
        // Read-only SDK endpoint used by the MES bridge to maintain its Sage stock cache.
        [HttpGet]
        [Route("")]
        public IHttpActionResult GetWarehouseStock([FromUri] string itemCode, [FromUri] string warehouse)
        {
            if (string.IsNullOrWhiteSpace(itemCode))
                return BadRequest("Item code is required.");
            if (string.IsNullOrWhiteSpace(warehouse))
                return BadRequest("Warehouse is required.");

            try
            {
                lock (SdkSession.OperationLock)
                {
                    return Ok(ReadStock(itemCode, warehouse));
                }
            }
            catch (Exception ex)
            {
                try
                {
                    // A stale SDK context is recoverable. Retry once before
                    // reporting an invalid item or warehouse to the bridge.
                    lock (SdkSession.OperationLock)
                    {
                        SdkSession.Reconnect();
                        return Ok(ReadStock(itemCode, warehouse));
                    }
                }
                catch (Exception retryException)
                {
                    return Content(HttpStatusCode.BadRequest, new
                    {
                        status = "failed",
                        message = "Sage stock lookup failed.",
                        exceptionMessage = retryException.Message,
                        initialExceptionMessage = ex.Message
                    });
                }
            }
        }

        private static object ReadStock(string itemCode, string warehouse)
        {
            SdkSession.EnsureConnected();

            var item = new InventoryItem(itemCode.Trim().ToUpperInvariant());
            var sageWarehouse = new Warehouse(warehouse.Trim().ToUpperInvariant());
            var context = item.WarehouseContexts[sageWarehouse];
            if (context == null)
                throw new InvalidOperationException("Sage has no warehouse context for " + item.Code + " in " + sageWarehouse.Code + ".");

            return new
            {
                status = "ok",
                environment = SageRuntime.EnvironmentName,
                itemCode = item.Code,
                warehouse = sageWarehouse.Code,
                quantity = context.QtyOnHand,
                averageUnitCost = context.AverageUnitCost,
                readAtUtc = DateTime.UtcNow
            };
        }
    }
}
