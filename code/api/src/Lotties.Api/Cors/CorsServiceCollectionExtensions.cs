using Lotties.Api.Endpoints;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Cors;

internal static class CorsServiceCollectionExtensions
{
    /// <summary>
    /// Registers a default CORS policy for <see cref="CorsSettings.Origins"/> with any header and method (bearer tokens, no
    /// cookies); the events cursor, the store epoch, the <c>ETag</c> (vaccine schedule revalidation) and <c>Retry-After</c> (a
    /// retriable <c>503 store_*</c>, SPEC "Events sync contract") are readable by the web app.
    /// </summary>
    public static IServiceCollection AddApiCors(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<CorsSettings>().Bind(configuration.GetSection(CorsSettings.SectionName));
        services.AddCors();
        services.AddOptions<CorsOptions>().Configure<IOptions<CorsSettings>>(ApplyDefaultPolicy);
        return services;
    }

    private static void ApplyDefaultPolicy(CorsOptions cors, IOptions<CorsSettings> settings) =>
        cors.AddDefaultPolicy(policy => policy
            .WithOrigins(settings.Value.Origins.ToArray())
            .AllowAnyHeader()
            .AllowAnyMethod()
            .WithExposedHeaders(EventEndpoints.NextCursorHeader, Stores.StoreScopeEndpointFilter.SyncEpochHeader, Microsoft.Net.Http.Headers.HeaderNames.ETag, Microsoft.Net.Http.Headers.HeaderNames.RetryAfter));
}
