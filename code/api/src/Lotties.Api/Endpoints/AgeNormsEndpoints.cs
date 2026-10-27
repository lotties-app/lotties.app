using Lotties.Api.Consents;
using Lotties.Application.AgeNorms;
using Microsoft.Net.Http.Headers;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The published age norms (docs/design/28-age-norms.md): the same file for everyone (any signed-in user), cached by the
/// web app for offline use like the vaccine schedule. Facts only, used as priors; nothing about a baby is involved.
/// </summary>
internal static class AgeNormsEndpoints
{
    public const string Path = "/age-norms";

    /// <summary>The norms may be cached privately for a day (they change about once a year); then a client revalidates.</summary>
    private const string CacheControl = "private, max-age=86400";

    /// <summary>
    /// Maps <c>GET /age-norms</c>: the file as shipped, with a strong <c>ETag</c> (304 on a matching <c>If-None-Match</c>)
    /// and <c>Cache-Control: private, max-age=86400</c>. Resolving the provider here validates the file at startup: an
    /// invalid file stops the API.
    /// </summary>
    public static IEndpointRouteBuilder MapAgeNormsEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _ = api.ServiceProvider.GetRequiredService<IAgeNormsProvider>();
        api.MapGet(Path, GetNorms)
            .AllowWithoutConsent("Published age facts, the same file for everyone, no baby is involved.")
            .WithName("GetAgeNorms")
            .Produces(StatusCodes.Status200OK, contentType: "application/json")
            .Produces(StatusCodes.Status304NotModified);
        return api;
    }

    private static IResult GetNorms(HttpContext http, IAgeNormsProvider norms)
    {
        http.Response.Headers.ETag = norms.ETag;
        http.Response.Headers.CacheControl = CacheControl;
        var requested = http.Request.GetTypedHeaders().IfNoneMatch;
        var current = new EntityTagHeaderValue(norms.ETag);
        return requested.Any(tag => tag.Compare(current, useStrongComparison: false) || tag.Equals(EntityTagHeaderValue.Any))
            ? Results.StatusCode(StatusCodes.Status304NotModified)
            : Results.Bytes(norms.Json, "application/json");
    }
}
