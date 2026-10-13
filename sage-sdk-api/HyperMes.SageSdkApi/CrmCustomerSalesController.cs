using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Net;
using System.Web.Http;

namespace SDK_Test
{
    // Read-only customer purchase activity. Sage is never updated by this endpoint.
    [RoutePrefix("api/v1/crm")]
    public class CrmCustomerSalesController : ApiController
    {
        private const int MaximumPageSize = 1000;

        [HttpGet]
        [Route("customer-sales")]
        public IHttpActionResult GetCustomerSales([FromUri] string fromDate, [FromUri] string toDate, [FromUri] int page = 1, [FromUri] int pageSize = 500)
        {
            DateTime from;
            DateTime to;
            if (!DateTime.TryParseExact(fromDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out from) ||
                !DateTime.TryParseExact(toDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out to))
                return BadRequest("fromDate and toDate must use YYYY-MM-DD.");
            if (to <= from || (to - from).TotalDays > 366) return BadRequest("Use a positive date range of up to 366 days.");
            if (page < 1 || pageSize < 1 || pageSize > MaximumPageSize) return BadRequest("Invalid page or pageSize.");

            try
            {
                var entries = ReadEntries(from, to, (page - 1) * pageSize, pageSize);
                return Ok(new {
                    status = "ok",
                    environment = SageRuntime.EnvironmentName,
                    companyDatabase = SageRuntime.CompanyDatabase,
                    fromDate = from.ToString("yyyy-MM-dd"),
                    toDate = to.ToString("yyyy-MM-dd"),
                    page,
                    pageSize,
                    count = entries.Count,
                    hasMore = entries.Count == pageSize,
                    entries,
                    readAtUtc = DateTime.UtcNow
                });
            }
            catch (Exception)
            {
                return Content(HttpStatusCode.ServiceUnavailable, new { status = "failed", message = "Sage customer-sales lookup failed." });
            }
        }

        private static List<object> ReadEntries(DateTime from, DateTime to, int offset, int pageSize)
        {
            const string sql = @"
WITH DailySales AS (
    SELECT
        CONVERT(date, i.InvDate) AS InvoiceDate,
        LTRIM(RTRIM(c.Account)) AS CustomerCode,
        LTRIM(RTRIM(c.Name)) AS CustomerName,
        CASE WHEN i.DocType = 4 THEN 'branch_pos' ELSE 'hq_invoiced' END AS SalesChannel,
        COUNT_BIG(*) AS DocumentCount,
        SUM(COALESCE(i.InvTotIncl, 0)) AS TotalSalesAmount
    FROM dbo.InvNum i
    INNER JOIN dbo.Client c ON c.DCLink = i.AccountID
    WHERE i.DocState = 4
      AND i.DocType IN (0, 4)
      AND i.InvDate >= @fromDate AND i.InvDate < @toDate
      AND i.AccountID IS NOT NULL
      AND LTRIM(RTRIM(c.Account)) <> ''
    GROUP BY CONVERT(date, i.InvDate), LTRIM(RTRIM(c.Account)), LTRIM(RTRIM(c.Name)), i.DocType
)
SELECT InvoiceDate, CustomerCode, CustomerName, SalesChannel, DocumentCount, TotalSalesAmount
FROM DailySales
ORDER BY InvoiceDate DESC, CustomerCode, SalesChannel
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;";
            var entries = new List<object>();
            using (var connection = new SqlConnection(GetReadOnlyConnectionString()))
            using (var command = new SqlCommand(sql, connection))
            {
                command.CommandTimeout = 60;
                command.Parameters.Add("@fromDate", SqlDbType.DateTime).Value = from;
                command.Parameters.Add("@toDate", SqlDbType.DateTime).Value = to;
                command.Parameters.Add("@offset", SqlDbType.Int).Value = offset;
                command.Parameters.Add("@pageSize", SqlDbType.Int).Value = pageSize;
                connection.Open();
                using (var reader = command.ExecuteReader())
                {
                    while (reader.Read()) entries.Add(new {
                        invoiceDate = Convert.ToDateTime(reader["InvoiceDate"]).ToString("yyyy-MM-dd"),
                        customerCode = Convert.ToString(reader["CustomerCode"]).Trim(),
                        customerName = Convert.ToString(reader["CustomerName"]).Trim(),
                        salesChannel = Convert.ToString(reader["SalesChannel"]),
                        documentCount = Convert.ToInt32(reader["DocumentCount"]),
                        totalSalesAmount = Convert.ToDecimal(reader["TotalSalesAmount"])
                    });
                }
            }
            return entries;
        }

        private static string GetReadOnlyConnectionString()
        {
            var server = Environment.GetEnvironmentVariable("HYPER_SAGE_COMPANY_SERVER") ?? Environment.GetEnvironmentVariable("HYPER_SAGE_SERVER");
            var database = SageRuntime.CompanyDatabase;
            var user = Environment.GetEnvironmentVariable("HYPER_SAGE_SQL_USERNAME");
            var password = Environment.GetEnvironmentVariable("HYPER_SAGE_SQL_PASSWORD");
            if (String.IsNullOrWhiteSpace(server) || String.IsNullOrWhiteSpace(database) || String.IsNullOrWhiteSpace(user) || password == null)
                throw new InvalidOperationException("CRM Sage read connection is not configured.");
            return String.Format("Server={0};Database={1};User Id={2};Password={3};Encrypt=False;TrustServerCertificate=True;", server, database, user, password);
        }
    }
}
