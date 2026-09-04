using System;
using System.Web.Http;

namespace SDK_Test
{
    [RoutePrefix("api/v1")]
    public class HealthController : ApiController
    {
        [HttpGet]
        [Route("health")]
        public IHttpActionResult GetHealth()
        {
            return Ok(new
            {
                status = "ok",
                api = "Hyperfeeds Sage SDK API",
                environment = SageRuntime.EnvironmentName,
                companyDatabase = SageRuntime.CompanyDatabase,
                writeMode = SageRuntime.WriteMode,
                allowedOperations = SageRuntime.AllowedOperations,
                sageConnection = "not-tested",
                timestampUtc = DateTime.UtcNow
            });
        }
    }
}
