using System;
using System.Data;
using System.Data.SqlClient;
using System.Linq;
using System.Net;
using System.Web.Http;
using System.Xml.Linq;

namespace SDK_Test
{
    [RoutePrefix("api/v1/manufacturing-processes")]
    public class ManufacturingProcessController : ApiController
    {
        [HttpPost]
        [Route("validate")]
        public IHttpActionResult Validate(ManufacturingProcessRequest request)
        {
            var error = ValidateRequest(request);
            if (error != null) return BadRequest(error);

            try
            {
                ValidateSageMasters(request);
                return Ok(Response(request, "validated", "Validated Sage BOM manufacturing process. No Sage process document was created."));
            }
            catch (Exception ex)
            {
                return Content(HttpStatusCode.BadRequest, new { status = "invalid", action = "manufacturing-process", message = ex.Message });
            }
        }

        [HttpPost]
        [Route("post")]
        public IHttpActionResult Post(ManufacturingProcessRequest request)
        {
            var error = ValidateRequest(request);
            if (error != null) return BadRequest(error);
            if (!request.ConfirmPost) return BadRequest("Posting is blocked. Set confirmPost to true only after approval.");

            try
            {
                ValidateSageMasters(request);
                var existing = FindProcess(request.ProcessReference, request.ExternalReference);
                if (existing != null) return Ok(Response(request, "already-posted", "Sage already contains this manufacturing process document.", existing));

                using (var connection = new SqlConnection(GetCompanyConnectionString()))
                {
                    connection.Open();
                    using (var transaction = connection.BeginTransaction(IsolationLevel.Serializable))
                    {
                        var existingInTransaction = FindProcess(connection, transaction, request.ProcessReference, request.ExternalReference);
                        if (existingInTransaction != null)
                        {
                            transaction.Commit();
                            return Ok(Response(request, "already-posted", "Sage already contains this manufacturing process document.", existingInTransaction));
                        }

                        var processReference = string.IsNullOrWhiteSpace(request.ProcessReference)
                            ? AllocateNextMfpReference(connection, transaction)
                            : request.ProcessReference.Trim();

                        using (var command = new SqlCommand("dbo.PostManufacturingProcessDocumentV1", connection, transaction))
                        {
                        command.CommandType = CommandType.StoredProcedure;
                        command.CommandTimeout = 120;
                        command.Parameters.Add("@ProcessReference", SqlDbType.VarChar, 50).Value = processReference;
                        command.Parameters.Add("@ExternalReference", SqlDbType.VarChar, 50).Value = (request.ExternalReference ?? "").Trim();
                        command.Parameters.Add("@FinishedGoodCode", SqlDbType.VarChar, 50).Value = request.FinishedGoodCode.Trim().ToUpperInvariant();
                        command.Parameters.Add("@Quantity", SqlDbType.Float).Value = (double)request.Quantity;
                        command.Parameters.Add("@WarehouseID", SqlDbType.Int).Value = request.WarehouseId;
                        command.Parameters.Add("@UnitCost", SqlDbType.Float).Value = (double)request.UnitCost;
                        command.Parameters.Add("@TransactionDate", SqlDbType.DateTime).Value = request.TransactionDate == default(DateTime) ? DateTime.Today : request.TransactionDate.Date;
                        command.Parameters.Add("@Description", SqlDbType.VarChar, 255).Value = request.Description ?? "";
                        command.Parameters.Add("@Components", SqlDbType.Xml).Value = ComponentsXml(request);
                        command.Parameters.Add("@ProjectID", SqlDbType.Int).Value = 0;
                        command.ExecuteNonQuery();
                        }
                        StampProcessLineReference(connection, transaction, processReference);
                        transaction.Commit();
                        return Ok(Response(request, "posted", "Sage manufacturing process document recorded. Inventory was not posted by this logging step.", processReference));
                    }
                }
            }
            catch (Exception ex)
            {
                return Content(HttpStatusCode.InternalServerError, new { status = "failed", action = "manufacturing-process", message = "Sage could not record this manufacturing process document.", exceptionMessage = ex.Message });
            }
        }

        private static void ValidateSageMasters(ManufacturingProcessRequest request)
        {
            using (var connection = new SqlConnection(GetCompanyConnectionString()))
            using (var command = new SqlCommand("SELECT BomID FROM dbo.BomMast WHERE BomStockCode = @Code", connection))
            {
                command.Parameters.Add("@Code", SqlDbType.VarChar, 50).Value = request.FinishedGoodCode.Trim().ToUpperInvariant();
                connection.Open();
                if (command.ExecuteScalar() == null) throw new InvalidOperationException("No Sage BOM exists for finished good " + request.FinishedGoodCode.Trim().ToUpperInvariant() + ".");
            }
        }

        private static string FindProcess(string reference, string externalReference)
        {
            using (var connection = new SqlConnection(GetCompanyConnectionString()))
            using (var command = new SqlCommand(@"
                SELECT TOP 1 cProcessRefNumber
                FROM dbo._etblManufProcess
                WHERE (@Reference <> '' AND cProcessRefNumber = @Reference)
                   OR (@ExternalReference <> '' AND cOtherRefNumber = @ExternalReference)
                ORDER BY idManufProcess DESC;", connection))
            {
                command.Parameters.Add("@Reference", SqlDbType.VarChar, 50).Value = (reference ?? "").Trim();
                command.Parameters.Add("@ExternalReference", SqlDbType.VarChar, 50).Value = (externalReference ?? "").Trim();
                connection.Open();
                var result = command.ExecuteScalar();
                return result == null ? null : Convert.ToString(result);
            }
        }

        private static string FindProcess(SqlConnection connection, SqlTransaction transaction, string reference, string externalReference)
        {
            using (var command = new SqlCommand(@"
                SELECT TOP 1 cProcessRefNumber
                FROM dbo._etblManufProcess WITH (UPDLOCK, HOLDLOCK)
                WHERE (@Reference <> '' AND cProcessRefNumber = @Reference)
                   OR (@ExternalReference <> '' AND cOtherRefNumber = @ExternalReference)
                ORDER BY idManufProcess DESC;", connection, transaction))
            {
                command.Parameters.Add("@Reference", SqlDbType.VarChar, 50).Value = (reference ?? "").Trim();
                command.Parameters.Add("@ExternalReference", SqlDbType.VarChar, 50).Value = (externalReference ?? "").Trim();
                var result = command.ExecuteScalar();
                return result == null ? null : Convert.ToString(result);
            }
        }

        private static string AllocateNextMfpReference(SqlConnection connection, SqlTransaction transaction)
        {
            using (var command = new SqlCommand(@"
                SELECT ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(cProcessRefNumber, 4, 50))), 0)
                FROM dbo._etblManufProcess WITH (TABLOCKX, HOLDLOCK)
                WHERE cProcessRefNumber LIKE 'MFP[0-9]%';", connection, transaction))
            {
                var highest = Convert.ToInt32(command.ExecuteScalar());
                return "MFP" + (highest + 1).ToString("000000");
            }
        }

        private static void StampProcessLineReference(SqlConnection connection, SqlTransaction transaction, string processReference)
        {
            using (var command = new SqlCommand(@"
                UPDATE line
                SET cReference = @ProcessReference
                FROM dbo._etblManufProcessLine AS line
                INNER JOIN dbo._etblManufProcess AS process ON process.idManufProcess = line.iManufProcessID
                WHERE process.cProcessRefNumber = @ProcessReference;", connection, transaction))
            {
                command.Parameters.Add("@ProcessReference", SqlDbType.VarChar, 50).Value = processReference.Trim();
                command.ExecuteNonQuery();
            }
        }

        private static string ComponentsXml(ManufacturingProcessRequest request)
        {
            return new XElement("components", request.Components.Select(component => new XElement("component",
                new XAttribute("sage_code", component.SageCode.Trim().ToUpperInvariant()),
                new XAttribute("quantity", component.Quantity),
                new XAttribute("unit_cost", component.UnitCost),
                new XAttribute("warehouse_id", component.WarehouseId),
                new XAttribute("description", component.Description ?? "")))).ToString(SaveOptions.DisableFormatting);
        }

        private static string ValidateRequest(ManufacturingProcessRequest request)
        {
            if (request == null) return "A manufacturing-process request is required.";
            if (string.IsNullOrWhiteSpace(request.ProcessReference) && string.IsNullOrWhiteSpace(request.ExternalReference)) return "ExternalReference is required when ProcessReference is not supplied.";
            if (string.IsNullOrWhiteSpace(request.FinishedGoodCode)) return "FinishedGoodCode is required.";
            if (request.Quantity <= 0) return "Quantity must be greater than zero.";
            if (request.WarehouseId <= 0) return "WarehouseId is required.";
            if (request.Components == null || request.Components.Length == 0) return "At least one component is required.";
            if (request.Components.Any(component => component == null || string.IsNullOrWhiteSpace(component.SageCode) || component.Quantity <= 0 || component.WarehouseId <= 0)) return "Every component requires a Sage code, positive quantity, and warehouse.";
            return null;
        }

        private static object Response(ManufacturingProcessRequest request, string status, string message, string processReference = null)
        {
            return new { status = status, environment = "UAT", action = "manufacturing-process", processReference = (processReference ?? request.ProcessReference ?? "").Trim(), externalReference = request.ExternalReference, finishedGoodCode = request.FinishedGoodCode.Trim().ToUpperInvariant(), message = message };
        }

        private static string GetCompanyConnectionString()
        {
            var server = Environment.GetEnvironmentVariable("HYPER_SAGE_COMPANY_SERVER");
            if (string.IsNullOrWhiteSpace(server)) server = Environment.GetEnvironmentVariable("HYPER_SAGE_SERVER");
            var database = Environment.GetEnvironmentVariable("HYPER_SAGE_COMPANY_DATABASE");
            var username = Environment.GetEnvironmentVariable("HYPER_SAGE_SQL_USERNAME");
            var password = Environment.GetEnvironmentVariable("HYPER_SAGE_SQL_PASSWORD");
            if (string.IsNullOrWhiteSpace(server) || string.IsNullOrWhiteSpace(database) || string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password)) throw new InvalidOperationException("Sage company SQL connection settings are missing.");
            return "Server=" + server + ";Database=" + database + ";User ID=" + username + ";Password=" + password + ";TrustServerCertificate=True;";
        }
    }
}
