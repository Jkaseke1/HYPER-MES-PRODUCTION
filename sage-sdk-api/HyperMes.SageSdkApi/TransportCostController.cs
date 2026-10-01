using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Web.Http;

namespace SDK_Test
{
    [RoutePrefix("api/v1/transport-costs")]
    public class TransportCostController : ApiController
    {
        // This endpoint is deliberately limited to configured carrier accounts and
        // PostAP reads. It cannot accept a SQL fragment, alter Sage, or post payments.
        [HttpGet]
        [Route("")]
        public IHttpActionResult Get([FromUri] string fromDate, [FromUri] string toDate, [FromUri] string accounts = null)
        {
            DateTime from;
            DateTime to;
            string dateError = ValidateDateRange(fromDate, toDate, out from, out to);
            if (dateError != null) return BadRequest(dateError);

            try
            {
                List<string> configuredAccounts = ReadConfiguredAccounts();
                List<string> requestedAccounts = ReadRequestedAccounts(accounts, configuredAccounts);

                lock (SdkSession.OperationLock)
                {
                    SdkSession.EnsureConnected();
                    return Ok(new
                    {
                        status = "ok",
                        environment = SageRuntime.EnvironmentName,
                        companyDatabase = SageRuntime.CompanyDatabase,
                        source = "PostAP",
                        fromDate = from.ToString("yyyy-MM-dd"),
                        toDate = to.ToString("yyyy-MM-dd"),
                        supplierAccounts = requestedAccounts,
                        entries = ReadEntries(from, to, requestedAccounts),
                        readAtUtc = DateTime.UtcNow
                    });
                }
            }
            catch (ArgumentException exception)
            {
                return BadRequest(exception.Message);
            }
            catch (Exception exception)
            {
                return Content(HttpStatusCode.ServiceUnavailable, new
                {
                    status = "failed",
                    message = "Sage transporter-cost lookup failed.",
                    exceptionMessage = exception.Message
                });
            }
        }

        private static string ValidateDateRange(string fromDate, string toDate, out DateTime from, out DateTime to)
        {
            const string format = "yyyy-MM-dd";
            if (!DateTime.TryParseExact(fromDate, format, CultureInfo.InvariantCulture, DateTimeStyles.None, out from) ||
                !DateTime.TryParseExact(toDate, format, CultureInfo.InvariantCulture, DateTimeStyles.None, out to))
                return "fromDate and toDate must use YYYY-MM-DD.";

            if (to <= from) return "toDate must be after fromDate.";
            if ((to - from).TotalDays > 180) return "The maximum read-only lookback is 180 days.";
            return null;
        }

        private static List<string> ReadConfiguredAccounts()
        {
            List<string> accounts = (Environment.GetEnvironmentVariable("HYPER_SAGE_TRANSPORTER_ACCOUNTS") ?? "")
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(value => value.Trim().ToUpperInvariant())
                .Where(value => value.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (accounts.Count == 0)
                throw new ArgumentException("Transporter reporting is disabled until HYPER_SAGE_TRANSPORTER_ACCOUNTS is configured.");
            if (accounts.Count > 50)
                throw new ArgumentException("Transporter reporting supports at most 50 configured supplier accounts.");
            return accounts;
        }

        private static List<string> ReadRequestedAccounts(string accounts, List<string> configuredAccounts)
        {
            if (String.IsNullOrWhiteSpace(accounts)) return configuredAccounts;
            List<string> requested = accounts.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(value => value.Trim().ToUpperInvariant())
                .Where(value => value.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (requested.Count == 0) throw new ArgumentException("At least one supplier account is required.");
            if (requested.Any(account => !configuredAccounts.Contains(account, StringComparer.OrdinalIgnoreCase)))
                throw new ArgumentException("A requested supplier account is not approved for transporter reporting.");
            return requested;
        }

        private static List<TransportCostEntry> ReadEntries(DateTime from, DateTime to, List<string> accounts)
        {
            List<TransportCostEntry> entries = new List<TransportCostEntry>();
            string parameters = String.Join(", ", accounts.Select((account, index) => "@account" + index));
            string commandText = @"
                SELECT
                    p.AutoIdx, CONVERT(date, p.TxDate) AS TransactionDate,
                    v.Account AS SupplierAccount, v.Name AS SupplierName,
                    p.Id AS TransactionType, p.Description, p.Reference,
                    p.cReference2 AS BatchReference, p.cAuditNumber AS AuditNumber,
                    p.Debit, p.Credit, p.Outstanding, p.iCurrencyID,
                    p.fForeignDebit, p.fForeignCredit, p.UserName, p.cAllocs AS PaymentAllocations
                FROM dbo.PostAP AS p
                INNER JOIN dbo.Vendor AS v ON v.DCLink = p.AccountLink
                WHERE p.TxDate >= @fromDate
                  AND p.TxDate < @toDate
                  AND p.Id IN ('APTx', 'CBAP')
                  AND v.Account IN (" + parameters + @")
                ORDER BY p.TxDate DESC, p.AutoIdx DESC;";

            using (SqlConnection connection = new SqlConnection(GetCompanyConnectionString()))
            using (SqlCommand command = new SqlCommand(commandText, connection))
            {
                command.Parameters.Add("@fromDate", SqlDbType.Date).Value = from.Date;
                command.Parameters.Add("@toDate", SqlDbType.Date).Value = to.Date;
                for (int index = 0; index < accounts.Count; index++)
                    command.Parameters.Add("@account" + index, SqlDbType.VarChar, 50).Value = accounts[index];

                connection.Open();
                using (SqlDataReader reader = command.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        entries.Add(new TransportCostEntry
                        {
                            AutoIndex = reader.GetInt64(reader.GetOrdinal("AutoIdx")),
                            TransactionDate = Convert.ToDateTime(reader["TransactionDate"]).ToString("yyyy-MM-dd"),
                            SupplierAccount = ReadString(reader, "SupplierAccount"),
                            SupplierName = ReadString(reader, "SupplierName"),
                            TransactionType = ReadString(reader, "TransactionType"),
                            Description = ReadString(reader, "Description"),
                            Reference = ReadString(reader, "Reference"),
                            BatchReference = ReadString(reader, "BatchReference"),
                            AuditNumber = ReadString(reader, "AuditNumber"),
                            Debit = ReadDecimal(reader, "Debit"),
                            Credit = ReadDecimal(reader, "Credit"),
                            Outstanding = ReadDecimal(reader, "Outstanding"),
                            CurrencyId = ReadInt(reader, "iCurrencyID"),
                            ForeignDebit = ReadDecimal(reader, "fForeignDebit"),
                            ForeignCredit = ReadDecimal(reader, "fForeignCredit"),
                            UserName = ReadString(reader, "UserName"),
                            PaymentAllocations = ReadString(reader, "PaymentAllocations")
                        });
                    }
                }
            }
            return entries;
        }

        private static string GetCompanyConnectionString()
        {
            SqlConnectionStringBuilder builder = new SqlConnectionStringBuilder
            {
                DataSource = GetRequiredSetting("HYPER_SAGE_COMPANY_SERVER"),
                InitialCatalog = GetRequiredSetting("HYPER_SAGE_COMPANY_DATABASE"),
                // The reporting credentials can be a narrowly scoped SQL login with
                // SELECT access to PostAP and Vendor only. Existing deployments fall
                // back to the current SDK login until that hardening is in place.
                UserID = GetOptionalSetting("HYPER_SAGE_REPORTING_SQL_USERNAME") ?? GetRequiredSetting("HYPER_SAGE_SQL_USERNAME"),
                Password = GetOptionalSetting("HYPER_SAGE_REPORTING_SQL_PASSWORD") ?? GetRequiredSetting("HYPER_SAGE_SQL_PASSWORD"),
                ConnectTimeout = 30,
                TrustServerCertificate = true
            };
            return builder.ConnectionString;
        }

        private static string GetRequiredSetting(string name)
        {
            string value = Environment.GetEnvironmentVariable(name);
            if (String.IsNullOrWhiteSpace(value)) throw new InvalidOperationException("Missing Windows environment variable: " + name);
            return value;
        }

        private static string GetOptionalSetting(string name)
        {
            string value = Environment.GetEnvironmentVariable(name);
            return String.IsNullOrWhiteSpace(value) ? null : value;
        }

        private static string ReadString(SqlDataReader reader, string column)
        {
            object value = reader[column];
            return value == DBNull.Value ? "" : Convert.ToString(value).Trim();
        }

        private static decimal ReadDecimal(SqlDataReader reader, string column)
        {
            object value = reader[column];
            return value == DBNull.Value ? 0m : Convert.ToDecimal(value);
        }

        private static int ReadInt(SqlDataReader reader, string column)
        {
            object value = reader[column];
            return value == DBNull.Value ? 0 : Convert.ToInt32(value);
        }

        private sealed class TransportCostEntry
        {
            public long AutoIndex { get; set; }
            public string TransactionDate { get; set; }
            public string SupplierAccount { get; set; }
            public string SupplierName { get; set; }
            public string TransactionType { get; set; }
            public string Description { get; set; }
            public string Reference { get; set; }
            public string BatchReference { get; set; }
            public string AuditNumber { get; set; }
            public decimal Debit { get; set; }
            public decimal Credit { get; set; }
            public decimal Outstanding { get; set; }
            public int CurrencyId { get; set; }
            public decimal ForeignDebit { get; set; }
            public decimal ForeignCredit { get; set; }
            public string UserName { get; set; }
            public string PaymentAllocations { get; set; }
        }
    }
}
