using BabyRoutine.Api.Endpoints;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.Extensions.Options;

namespace BabyRoutine.Api.Cors;

internal static class CorsServiceCollectionExtensions
{
    /// <summary>Registers a default CORS policy for <see cref="CorsSettings.Origins"/> with any header and method (bearer tokens, no cookies).</summary>
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
            .WithExposedHeaders(EventEndpoints.NextCursorHeader));
}
