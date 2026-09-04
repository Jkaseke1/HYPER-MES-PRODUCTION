using Microsoft.Owin;
using System;
using System.Threading.Tasks;

namespace SDK_Test
{
    public sealed class WriteSafetyMiddleware : OwinMiddleware
    {
        public WriteSafetyMiddleware(OwinMiddleware next) : base(next) { }

        public override async Task Invoke(IOwinContext context)
        {
            var path = context.Request.Path.Value ?? "";
            var isPostingRequest = string.Equals(context.Request.Method, "POST", StringComparison.OrdinalIgnoreCase)
                && path.EndsWith("/post", StringComparison.OrdinalIgnoreCase);

            if (isPostingRequest)
            {
                try
                {
                    SageRuntime.EnsureWriteAllowed(path);
                }
                catch (Exception exception)
                {
                    context.Response.StatusCode = 403;
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync(
                        "{\"status\":\"blocked\",\"message\":"
                        + Newtonsoft.Json.JsonConvert.ToString(exception.Message) + "}"
                    );
                    return;
                }
            }

            await Next.Invoke(context);
        }
    }
}
