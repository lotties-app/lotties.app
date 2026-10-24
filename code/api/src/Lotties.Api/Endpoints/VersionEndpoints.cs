using Lotties.Api.Configuration;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>What <c>GET /version</c> answers: the build's name, release, commit and build time, nothing else.</summary>
public sealed class VersionResponse
{
    public const string ApiName = "lotties-api";

    public string Name { get; set; } = ApiName;

    /// <summary>The release X.Y.Z, or <c>dev</c> for a build the deploy did not stamp.</summary>
    public string Version { get; set; } = BuildStamp.DevVersion;

    /// <summary>The short commit; empty when unknown.</summary>
    public string Commit { get; set; } = string.Empty;

    /// <summary>When the image was built (UTC); null when unknown.</summary>
    public DateTimeOffset? BuiltAt { get; set; }

    public static implicit operator VersionResponse(BuildStamp stamp)
    {
        ArgumentNullException.ThrowIfNull(stamp);
        return new VersionResponse { Version = stamp.Version, Commit = stamp.Commit, BuiltAt = stamp.BuiltAt };
    }
}

/// <summary>
/// The running API's release (docs/SPEC.md "Version"), shown by the web app's About screen next to its own. Public and
/// anonymous: no environment, configuration or user detail, only what the deploy stamped. Counted by the global rate
/// limiter (anonymous callers per address) and cacheable for a few seconds.
/// </summary>
internal static class VersionEndpoints
{
    public const string Path = "/version";

    private const string CacheControl = "public, max-age=10";

    /// <summary>Maps the anonymous <c>GET /version</c>; the stamp is read once, when the routes are mapped.</summary>
    public static IEndpointRouteBuilder MapVersionEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        VersionResponse response = BuildStamp.FromConfiguration(api.ServiceProvider.GetRequiredService<IConfiguration>());
        api.MapGet(Path, (HttpContext http) => GetVersion(http, response))
            .AllowAnonymous()
            .WithName("GetVersion");
        return api;
    }

    private static Ok<VersionResponse> GetVersion(HttpContext http, VersionResponse response)
    {
        http.Response.Headers.CacheControl = CacheControl;
        return TypedResults.Ok(response);
    }
}
