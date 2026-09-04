using Microsoft.Owin.Hosting;
using System;

namespace SDK_Test
{
    internal class Program
    {
        private static void Main(string[] args)
        {
            var baseAddress = SageRuntime.ApiUrl;

            using (WebApp.Start<Startup>(baseAddress))
            {
                Console.WriteLine("Hyperfeeds Sage SDK API is running in " + SageRuntime.EnvironmentName + " mode.");
                Console.WriteLine("Company database: " + SageRuntime.CompanyDatabase);
                Console.WriteLine("Write mode: " + SageRuntime.WriteMode);
                Console.WriteLine("Health check: " + baseAddress.TrimEnd('/') + "/api/v1/health");
                Console.WriteLine("Press Enter to stop the API.");
                Console.ReadLine();
            }
        }
    }
}
