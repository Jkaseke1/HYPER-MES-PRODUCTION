using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Net;
using System.Web.Http;

namespace SDK_Test
{
    // Reporting-only endpoint. It reads the same aggregated view used by Power BI.
    [RoutePrefix("api/v1/reporting/sold-tonnage")]
    public class SoldTonnageController : ApiController
    {
        [HttpGet]
        [Route("")]
        public IHttpActionResult Get([FromUri] string fromDate, [FromUri] string toDate)
        {
            DateTime from; DateTime to;
            if (!DateTime.TryParseExact(fromDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out from) ||
                !DateTime.TryParseExact(toDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out to))
                return BadRequest("fromDate and toDate must use YYYY-MM-DD.");
            if (to <= from || (to - from).TotalDays > 366) return BadRequest("Use a positive date range of up to 366 days.");

            try
            {
                return Ok(new { status = "ok", source = "Hyperfeeds_Reporting.dbo.vw_HF_TonnageSummaryReported", fromDate = from.ToString("yyyy-MM-dd"), toDate = to.ToString("yyyy-MM-dd"), entries = ReadEntries(from, to), readAtUtc = DateTime.UtcNow });
            }
            catch (Exception exception)
            {
                return Content(HttpStatusCode.ServiceUnavailable, new { status = "failed", message = "Sage sold-tonnage lookup failed.", exceptionMessage = exception.Message });
            }
        }

        private static List<SoldTonnageEntry> ReadEntries(DateTime from, DateTime to)
        {
            const string sql = @"
                SELECT CONVERT(date, InvDate) AS InvoiceDate, WarehouseCode, WarehouseName,
                       Category, SubCategory, TransactionType, ReportingCategory,
                       TotalTonnes, TotalSalesAmount, LineCount
                FROM dbo.vw_HF_TonnageSummaryReported
                WHERE InvDate >= @fromDate AND InvDate < @toDate
                  AND TransactionType IN ('Branch POS', 'HQ Invoiced')
                ORDER BY InvDate DESC, WarehouseCode, ReportingCategory;";
            List<SoldTonnageEntry> entries = new List<SoldTonnageEntry>();
            using (SqlConnection connection = new SqlConnection(GetReportingConnectionString()))
            using (SqlCommand command = new SqlCommand(sql, connection))
            {
                command.Parameters.Add("@fromDate", SqlDbType.Date).Value = from.Date;
                command.Parameters.Add("@toDate", SqlDbType.Date).Value = to.Date;
                connection.Open();
                using (SqlDataReader reader = command.ExecuteReader())
                    while (reader.Read()) entries.Add(new SoldTonnageEntry {
                        InvoiceDate = Convert.ToDateTime(reader["InvoiceDate"]).ToString("yyyy-MM-dd"),
                        WarehouseCode = ReadString(reader, "WarehouseCode"), WarehouseName = ReadString(reader, "WarehouseName"),
                        Category = ReadString(reader, "Category"), SubCategory = ReadString(reader, "SubCategory"),
                        TransactionType = ReadString(reader, "TransactionType"), ReportingCategory = ReadString(reader, "ReportingCategory"),
                        TotalTonnes = ReadDecimal(reader, "TotalTonnes"), TotalSalesAmount = ReadDecimal(reader, "TotalSalesAmount"),
                        LineCount = reader["LineCount"] == DBNull.Value ? 0 : Convert.ToInt32(reader["LineCount"])
                    });
            }
            return entries;
        }

        private static SqlConnectionStringBuilder GetReportingConnectionString()
        {
            return new SqlConnectionStringBuilder {
                DataSource = Required("HYPER_SAGE_REPORTING_SERVER"), InitialCatalog = Required("HYPER_SAGE_REPORTING_DATABASE"),
                UserID = Required("HYPER_SAGE_REPORTING_SQL_USERNAME"), Password = Required("HYPER_SAGE_REPORTING_SQL_PASSWORD"),
                ConnectTimeout = 30, TrustServerCertificate = true
            };
        }
        private static string Required(string name) { string value = Environment.GetEnvironmentVariable(name); if (String.IsNullOrWhiteSpace(value)) throw new InvalidOperationException("Missing Windows environment variable: " + name); return value; }
        private static string ReadString(SqlDataReader reader, string name) { object value = reader[name]; return value == DBNull.Value ? "" : Convert.ToString(value).Trim(); }
        private static decimal ReadDecimal(SqlDataReader reader, string name) { object value = reader[name]; return value == DBNull.Value ? 0m : Convert.ToDecimal(value); }
        private sealed class SoldTonnageEntry { public string InvoiceDate { get; set; } public string WarehouseCode { get; set; } public string WarehouseName { get; set; } public string Category { get; set; } public string SubCategory { get; set; } public string TransactionType { get; set; } public string ReportingCategory { get; set; } public decimal TotalTonnes { get; set; } public decimal TotalSalesAmount { get; set; } public int LineCount { get; set; } }
    }
}
