using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Proxy;

internal static class ForwardedHeadersServiceCollectionExtensions
{
    /// <summary>
    /// Registers <see cref="ForwardedHeadersSettings"/> (validated at startup) and configures the forwarded headers
    /// middleware: <c>X-Forwarded-For</c> and <c>X-Forwarded-Proto</c> are applied only to connections from a trusted
    /// network (plus loopback, the framework default), and only the last <c>X-Forwarded-For</c> entry is used: the
    /// one the trusted proxy appended itself, so a client cannot choose its own address by sending the header.
    /// </summary>
    public static IServiceCollection AddTrustedProxyHeaders(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<ForwardedHeadersSettings>().Bind(configuration.GetSection(ForwardedHeadersSettings.SectionName)).ValidateOnStart();
        services.AddSingleton<IValidateOptions<ForwardedHeadersSettings>, ForwardedHeadersSettingsValidator>();
        services.AddOptions<ForwardedHeadersOptions>().Configure<IOptions<ForwardedHeadersSettings>>((forwarded, settings) => Apply(forwarded, settings.Value));
        return services;
    }

    /// <summary>Applies the trusted forwarded headers; call first, so the rate limiter and everything after it see the client address.</summary>
    public static IApplicationBuilder UseTrustedProxyHeaders(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.UseForwardedHeaders();
    }

    private static void Apply(ForwardedHeadersOptions forwarded, ForwardedHeadersSettings settings)
    {
        forwarded.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        forwarded.ForwardLimit = 1;
        foreach (var network in settings.Networks())
        {
            forwarded.KnownNetworks.Add(network);
        }
    }
}
