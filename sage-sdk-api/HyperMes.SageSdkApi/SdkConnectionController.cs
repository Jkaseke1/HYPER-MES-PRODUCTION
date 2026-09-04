using Pastel.Evolution;
using System;
using System.Net;
using System.Web.Http;

namespace SDK_Test
{
    [RoutePrefix("api/v1/sdk")]
    public class SdkConnectionController : ApiController
    {
        [HttpGet]
        [Route("connection")]
        public IHttpActionResult CheckConnection()
        {
            try
            {
                // Evolution keeps its connection in global process state. Health checks
                // must use the same gate as stock reads and posting operations.
                lock (SdkSession.OperationLock)
                {
                    SdkSession.EnsureConnected();
                }

                return Ok(new
                {
                    status = "ok",
                    environment = SageRuntime.EnvironmentName,
                    companyDatabase = SageRuntime.CompanyDatabase,
                    commonDatabase = SageRuntime.CommonDatabase,
                    writeMode = SageRuntime.WriteMode,
                    allowedOperations = SageRuntime.AllowedOperations,
                    sdkConnection = "successful",
                    message = "SDK connection verified. No Sage transaction was created."
                });
            }
            catch (Exception ex)
            {
                return Content(HttpStatusCode.ServiceUnavailable, new
                {
                    status = "failed",
                    environment = SageRuntime.EnvironmentName,
                    companyDatabase = SageRuntime.CompanyDatabase,
                    sdkConnection = "failed",
                    message = ex.Message
                });
            }
        }

        private static string GetRequiredSetting(string name)
        {
            var value = Environment.GetEnvironmentVariable(name);

            if (string.IsNullOrWhiteSpace(value))
            {
                throw new InvalidOperationException(
                    "Missing Windows environment variable: " + name
                );
            }

            return value;
        }

        private static string GetServerSetting(string specificName)
        {
            var value = Environment.GetEnvironmentVariable(specificName);
            if (!string.IsNullOrWhiteSpace(value)) return value;
            return GetRequiredSetting("HYPER_SAGE_SERVER");
        }
    }
}
