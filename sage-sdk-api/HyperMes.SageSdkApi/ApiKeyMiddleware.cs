using Microsoft.Owin;
using System;
using System.Text;
using System.Threading.Tasks;

namespace SDK_Test
{
    public sealed class ApiKeyMiddleware : OwinMiddleware
    {
        public ApiKeyMiddleware(OwinMiddleware next) : base(next) { }

        public override async Task Invoke(IOwinContext context)
        {
            // Public only: confirms that the local API process is running.
            if (context.Request.Path.Value == "/api/v1/health")
            {
                await Next.Invoke(context);
                return;
            }

            var expectedKey = Environment.GetEnvironmentVariable("HYPER_SAGE_API_KEY");
            var suppliedKey = context.Request.Headers.Get("X-Hyper-Api-Key");

            if (string.IsNullOrWhiteSpace(expectedKey))
            {
                context.Response.StatusCode = 503;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(
                    "{\"status\":\"failed\",\"message\":\"API key is not configured.\"}"
                );
                return;
            }

            if (!SecureEquals(expectedKey, suppliedKey))
            {
                context.Response.StatusCode = 401;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(
                    "{\"status\":\"unauthorized\",\"message\":\"A valid X-Hyper-Api-Key header is required.\"}"
                );
                return;
            }

            await Next.Invoke(context);
        }

        private static bool SecureEquals(string expected, string supplied)
        {
            if (string.IsNullOrWhiteSpace(supplied))
                return false;

            var expectedBytes = Encoding.UTF8.GetBytes(expected);
            var suppliedBytes = Encoding.UTF8.GetBytes(supplied);

            if (expectedBytes.Length != suppliedBytes.Length)
                return false;

            var difference = 0;

            for (var index = 0; index < expectedBytes.Length; index++)
            {
                difference |= expectedBytes[index] ^ suppliedBytes[index];
            }

            return difference == 0;
        }
    }
}