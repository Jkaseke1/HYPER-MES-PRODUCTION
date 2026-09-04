using Pastel.Evolution;
using System;

namespace SDK_Test
{
    public static class SdkSession
    {
        private static readonly object ConnectionLock = new object();
        private static bool _connected;

        // Evolution keeps its database connection in static process state. Every
        // SDK read and post must therefore use this one gate; otherwise a stock
        // lookup can disrupt an in-flight inventory transaction on another HTTP thread.
        public static object OperationLock
        {
            get { return ConnectionLock; }
        }

        public static void EnsureConnected()
        {
            lock (ConnectionLock)
            {
                if (_connected)
                    return;

                var commonServer = GetServerSetting("HYPER_SAGE_COMMON_SERVER");
                var companyServer = GetServerSetting("HYPER_SAGE_COMPANY_SERVER");
                var commonDatabase = GetRequiredSetting("HYPER_SAGE_COMMON_DATABASE");
                var companyDatabase = GetRequiredSetting("HYPER_SAGE_COMPANY_DATABASE");
                var sqlUsername = GetRequiredSetting("HYPER_SAGE_SQL_USERNAME");
                var sqlPassword = GetRequiredSetting("HYPER_SAGE_SQL_PASSWORD");
                var sdkSerial = GetRequiredSetting("HYPER_SAGE_SDK_SERIAL");
                var sdkAuthCode = GetRequiredSetting("HYPER_SAGE_SDK_AUTH_CODE");

                DatabaseContext.CreateCommonDBConnection(
                    commonServer, commonDatabase, sqlUsername, sqlPassword, false);

                DatabaseContext.SetLicense(sdkSerial, sdkAuthCode);

                DatabaseContext.CreateConnection(
                    companyServer, companyDatabase, sqlUsername, sqlPassword, false);

                _connected = true;
            }
        }

        // The Evolution SDK can drop its static database context while the local
        // process remains alive. Read-only callers retry once through this path.
        public static void Reconnect()
        {
            lock (ConnectionLock)
            {
                _connected = false;
            }

            EnsureConnected();
        }

        public static bool IsRecoverableConnectionError(Exception exception)
        {
            var message = exception == null ? "" : exception.Message ?? "";
            return exception is EvolutionException && (
                message.IndexOf("connection has not been initial", StringComparison.OrdinalIgnoreCase) >= 0 ||
                message.IndexOf("CreateConnection first", StringComparison.OrdinalIgnoreCase) >= 0);
        }

        private static string GetRequiredSetting(string name)
        {
            var value = Environment.GetEnvironmentVariable(name);

            if (string.IsNullOrWhiteSpace(value))
                throw new InvalidOperationException(
                    "Missing Windows environment variable: " + name);

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
