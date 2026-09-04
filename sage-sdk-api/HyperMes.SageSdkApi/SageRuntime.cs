using System;
using System.Collections.Generic;
using System.Linq;

namespace SDK_Test
{
    public static class SageRuntime
    {
        public static string EnvironmentName
        {
            get { return GetSetting("HYPER_SAGE_ENVIRONMENT", "UAT"); }
        }

        public static string CompanyDatabase
        {
            get { return GetSetting("HYPER_SAGE_COMPANY_DATABASE", "not-configured"); }
        }

        public static string CommonDatabase
        {
            get { return GetSetting("HYPER_SAGE_COMMON_DATABASE", "not-configured"); }
        }

        public static string ApiUrl
        {
            get { return GetSetting("HYPER_SAGE_API_URL", "http://127.0.0.1:5088/"); }
        }

        public static string WriteMode
        {
            get { return GetSetting("HYPER_SAGE_WRITE_MODE", "Disabled"); }
        }

        public static IEnumerable<string> AllowedOperations
        {
            get
            {
                return GetSetting("HYPER_SAGE_ALLOWED_OPERATIONS", "")
                    .Split(',')
                    .Select(value => value.Trim().ToLowerInvariant())
                    .Where(value => value.Length > 0);
            }
        }

        public static void EnsureWriteAllowed(string requestPath)
        {
            if (!string.Equals(WriteMode, "Enabled", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Sage writes are disabled by HYPER_SAGE_WRITE_MODE.");

            var environment = EnvironmentName;
            var companyDatabase = CompanyDatabase;
            var liveDatabase = GetSetting("HYPER_SAGE_LIVE_COMPANY_DATABASE", "Hyperfeeds 2024");
            var isLiveDatabase = string.Equals(companyDatabase, liveDatabase, StringComparison.OrdinalIgnoreCase);
            var isProduction = string.Equals(environment, "Production", StringComparison.OrdinalIgnoreCase);

            if (isLiveDatabase && !isProduction)
                throw new InvalidOperationException("Live Sage database writes require HYPER_SAGE_ENVIRONMENT=Production.");

            if (isProduction && !isLiveDatabase)
                throw new InvalidOperationException("Production mode is not connected to the approved live Sage database.");

            var operation = OperationFromPath(requestPath);
            if (!AllowedOperations.Contains(operation, StringComparer.OrdinalIgnoreCase))
                throw new InvalidOperationException("Sage operation is not enabled: " + operation + ".");
        }

        private static string OperationFromPath(string requestPath)
        {
            var segments = (requestPath ?? "")
                .Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            return segments.Length >= 3 ? segments[2].ToLowerInvariant() : "unknown";
        }

        private static string GetSetting(string name, string fallback)
        {
            var value = Environment.GetEnvironmentVariable(name);
            return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
        }
    }
}
