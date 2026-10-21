using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// Gives a test request the connection address named in <see cref="Header"/>, ahead of the API's own pipeline: the
/// test server leaves the remote address empty, so a test can play a request that reaches the API through a proxy.
/// </summary>
internal sealed class RemoteAddressStartupFilter : IStartupFilter
{
    public const string Header = "X-Test-Remote-Address";

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use((context, nextMiddleware) =>
        {
            if (IPAddress.TryParse(context.Request.Headers[Header].ToString(), out var address))
            {
                context.Connection.RemoteIpAddress = address;
            }

            return nextMiddleware(context);
        });
        next(app);
    };
}
