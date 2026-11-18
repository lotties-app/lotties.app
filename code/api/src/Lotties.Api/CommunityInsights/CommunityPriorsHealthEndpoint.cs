using Lotties.Api.Consents;
using Lotties.Application.CommunityInsights;

namespace Lotties.Api.CommunityInsights;

/// <summary>Public health probe for the community priors subsystem (docs/design/34-community-insights.md).</summary>
internal static class CommunityPriorsHealthEndpoint
{
    public const string Route = "/health/community-priors";

    /// <summary>Maps the anonymous <c>/health/community-priors</c> probe. No baby data is exposed.</summary>
    public static WebApplication MapCommunityPriorsHealthEndpoint(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.MapGet(Route, (ICommunityStatisticsCatalogProvider? provider) =>
        {
            if (provider is null)
            {
                return Results.Ok(new HealthResponse(Status: "not-configured", Release: null, FileVersion: null));
            }

            try
            {
                var catalog = provider.Catalog;
                return Results.Ok(new HealthResponse(
                    Status: "loaded",
                    Release: catalog.Release,
                    FileVersion: catalog.Version.ToString()));
            }
            catch
            {
                return Results.Ok(new HealthResponse(Status: "failed", Release: null, FileVersion: null));
            }
        }).AllowAnonymous().AllowWithoutConsent("A health probe: the community statistics catalog's load state and version, no user data.").DisableRateLimiting();
        return app;
    }

    private sealed record HealthResponse(string Status, string? Release, string? FileVersion);
}