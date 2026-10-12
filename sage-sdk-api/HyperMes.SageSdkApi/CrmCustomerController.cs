using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Net;
using System.Web.Http;

namespace SDK_Test
{
    // Bridge-only, read-only Sage Client master endpoint. It deliberately does
    // not expose invoices, orders, or database credentials to browser clients.
    [RoutePrefix("api/v1/crm")]
    public class CrmCustomerController : ApiController
    {
        private const int MaximumPageSize = 500;

        [HttpGet]
        [Route("customers")]
        public IHttpActionResult GetCustomers([FromUri] int page = 1, [FromUri] int pageSize = 250, [FromUri] DateTime? changedSince = null)
        {
            if (page < 1) return BadRequest("page must be at least 1.");
            if (pageSize < 1 || pageSize > MaximumPageSize)
                return BadRequest("pageSize must be between 1 and " + MaximumPageSize + ".");

            try
            {
                var customers = new List<object>();
                var offset = (page - 1) * pageSize;
                var connectionString = GetReadOnlyConnectionString();

                using (var connection = new SqlConnection(connectionString))
                using (var command = connection.CreateCommand())
                {
                    command.CommandTimeout = 60;
                    command.CommandText = @"
SELECT c.DCLink, LTRIM(RTRIM(c.Account)) Account, LTRIM(RTRIM(c.Name)) Name,
       LTRIM(RTRIM(c.Contact_Person)) ContactPerson, LTRIM(RTRIM(c.EMail)) Email,
       LTRIM(RTRIM(c.Telephone)) Telephone, LTRIM(RTRIM(c.Physical1)) Physical1,
       LTRIM(RTRIM(c.Physical2)) Physical2, LTRIM(RTRIM(c.Physical3)) Physical3,
       LTRIM(RTRIM(c.Physical4)) Physical4, LTRIM(RTRIM(c.Physical5)) Physical5,
       LTRIM(RTRIM(c.Post1)) Post1, LTRIM(RTRIM(c.Post2)) Post2,
       LTRIM(RTRIM(c.Post3)) Post3, LTRIM(RTRIM(c.Post4)) Post4, LTRIM(RTRIM(c.Post5)) Post5,
       LTRIM(RTRIM(c.GroupDescription)) GroupDescription, LTRIM(RTRIM(c.AreaDescription)) AreaDescription,
       LTRIM(RTRIM(c.CurrencyCode)) CurrencyCode, LTRIM(RTRIM(c.AccountTerms)) AccountTerms,
       LTRIM(RTRIM(c.Tax_Number)) TaxNumber, LTRIM(RTRIM(c.Registration)) Registration,
       LTRIM(RTRIM(c.RepCode)) RepCode, LTRIM(RTRIM(c.RepName)) RepName,
       c.Credit_Limit CreditLimit, c.DCBalance AccountBalance, COALESCE(c.On_Hold, 0) OnHold,
       COALESCE(c.CashDebtor, 0) CashDebtor, COALESCE(c.bCODAccount, 0) CashOnDelivery,
       COALESCE(c.bInsuranceCustomer, 0) InsuranceCustomer, c.Client_dModifiedDate ModifiedAt
FROM dbo.Client c
WHERE c.DCLink IS NOT NULL AND LTRIM(RTRIM(c.Account)) <> ''
  AND (@changedSince IS NULL OR c.Client_dModifiedDate >= @changedSince)
ORDER BY c.Account, c.DCLink
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;";
                    command.Parameters.Add("@changedSince", SqlDbType.DateTime).Value = (object)changedSince ?? DBNull.Value;
                    command.Parameters.Add("@offset", SqlDbType.Int).Value = offset;
                    command.Parameters.Add("@pageSize", SqlDbType.Int).Value = pageSize;
                    connection.Open();
                    using (var reader = command.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            customers.Add(new {
                                sageCustomerId = Value(reader, "DCLink"), account = Value(reader, "Account"), name = Value(reader, "Name"),
                                contactPerson = Value(reader, "ContactPerson"), email = Value(reader, "Email"), telephone = Value(reader, "Telephone"),
                                physical = new[] { Value(reader, "Physical1"), Value(reader, "Physical2"), Value(reader, "Physical3"), Value(reader, "Physical4"), Value(reader, "Physical5") },
                                postal = new[] { Value(reader, "Post1"), Value(reader, "Post2"), Value(reader, "Post3"), Value(reader, "Post4"), Value(reader, "Post5") },
                                groupDescription = Value(reader, "GroupDescription"), areaDescription = Value(reader, "AreaDescription"),
                                currencyCode = Value(reader, "CurrencyCode"), accountTerms = Value(reader, "AccountTerms"), taxNumber = Value(reader, "TaxNumber"),
                                registration = Value(reader, "Registration"), repCode = Value(reader, "RepCode"), repName = Value(reader, "RepName"),
                                creditLimit = Value(reader, "CreditLimit"), accountBalance = Value(reader, "AccountBalance"), onHold = Value(reader, "OnHold"),
                                cashDebtor = Value(reader, "CashDebtor"), cashOnDelivery = Value(reader, "CashOnDelivery"), insuranceCustomer = Value(reader, "InsuranceCustomer"), modifiedAt = Value(reader, "ModifiedAt")
                            });
                        }
                    }
                }
                return Ok(new { status = "ok", environment = SageRuntime.EnvironmentName, companyDatabase = SageRuntime.CompanyDatabase, page, pageSize, count = customers.Count, hasMore = customers.Count == pageSize, customers, readAtUtc = DateTime.UtcNow });
            }
            catch (Exception)
            {
                return Content(HttpStatusCode.InternalServerError, new { status = "failed", message = "Sage CRM customer lookup failed." });
            }
        }

        private static object Value(IDataRecord record, string column)
        {
            var ordinal = record.GetOrdinal(column);
            return record.IsDBNull(ordinal) ? null : record.GetValue(ordinal);
        }

        private static string GetReadOnlyConnectionString()
        {
            var server = Environment.GetEnvironmentVariable("HYPER_SAGE_REPORTING_SERVER") ?? Environment.GetEnvironmentVariable("HYPER_SAGE_COMPANY_SERVER") ?? Environment.GetEnvironmentVariable("HYPER_SAGE_SERVER");
            var database = SageRuntime.CompanyDatabase;
            var user = Environment.GetEnvironmentVariable("HYPER_SAGE_REPORTING_SQL_USERNAME") ?? Environment.GetEnvironmentVariable("HYPER_SAGE_SQL_USERNAME");
            var password = Environment.GetEnvironmentVariable("HYPER_SAGE_REPORTING_SQL_PASSWORD") ?? Environment.GetEnvironmentVariable("HYPER_SAGE_SQL_PASSWORD");
            if (String.IsNullOrWhiteSpace(server) || String.IsNullOrWhiteSpace(database) || String.IsNullOrWhiteSpace(user) || password == null)
                throw new InvalidOperationException("CRM Sage read connection is not configured.");
            return String.Format("Server={0};Database={1};User Id={2};Password={3};Encrypt=False;TrustServerCertificate=True;", server, database, user, password);
        }
    }
}
