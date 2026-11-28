using System.Security.Cryptography;
using System.Text.Json;
using Lotties.Api.Authorization;
using Lotties.Api.Endpoints;
using Lotties.Application.CommunityInsights;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Lotties.Api.CommunityInsights;

/// <summary>
/// The community statistics of one baby (docs/design/34-community-insights.md section 6 "Serving"):
/// <c>GET /babies/{babyId}/community-statistics</c>, every v1 statistic for her age from the active release in one answer
/// (<see cref="ICommunityStatisticsService"/>). Facts only, never advice. Her family only (<see cref="BabyPolicies.ReadFamily"/>: Owner,
/// Parent, Caregiver, Viewer; a Doctor 403 whatever her scopes, the statistics are family-level, never clinical); a demo 403
/// <c>demo_not_available</c>; 403 <c>community_consent_required</c> unless her consent is in force under the current text; a bare 404
/// while <c>CommunityInsights:Enabled</c> is off (<see cref="CommunityInsightsRequestGuard"/>, before any 401). Behind the consent gate,
/// rate limited per account. No store binding: everything it reads is control plane.
/// </summary>
/// <remarks>
/// Cached privately for a short time, with a strong <c>ETag</c> over the baby id, the release row and the exact body, so the validator
/// changes with the release, with her served cells (her age moving to another band) and with anything else in the answer, and two babies
/// never share one; <c>If-None-Match</c> gives 304. <c>Vary: Authorization</c> keeps a browser from reusing one account's copy for
/// another signed in on the same device.
/// </remarks>
internal static class CommunityStatisticsEndpoint
{
    public const string Path = "/community-statistics";

    /// <summary>Private, five minutes: a release changes at most once a quarter, a baby's band at most once a week (at her UTC day change).</summary>
    private const string CacheControl = "private, max-age=300";

    /// <summary>Maps <c>GET /babies/{babyId}/community-statistics</c>.</summary>
    public static IEndpointRouteBuilder MapCommunityStatisticsEndpoint(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        api.MapGroup(BabyRoutes.Prefix)
            .RequireAuthorization(BabyPolicies.ReadFamily)
            .WithMetadata(CommunityInsightsEndpointMetadata.Instance)
            .MapGet(Path, GetAsync)
            .RequireRateLimiting(Limits.RequestLimitPolicies.CommunityStatisticsRead)
            .WithName("GetCommunityStatistics")
            .Produces<CommunityStatisticsResponse>(StatusCodes.Status200OK, contentType: "application/json")
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);
        return api;
    }

    private static async Task<IResult> GetAsync(
        Guid babyId,
        HttpContext http,
        ICommunityStatisticsService statistics,
        IOptions<JsonOptions> json,
        CancellationToken cancellationToken)
    {
        var answer = await statistics.GetAsync(babyId, cancellationToken);
        var body = JsonSerializer.SerializeToUtf8Bytes(answer.Response, json.Value.SerializerOptions);
        var etag = ETagOf(babyId, answer.ReleaseRowId, body);
        http.Response.Headers.ETag = etag;
        http.Response.Headers.CacheControl = CacheControl;
        http.Response.Headers.Vary = HeaderNames.Authorization;

        var current = new EntityTagHeaderValue(etag);
        return http.Request.GetTypedHeaders().IfNoneMatch.Any(tag => tag.Compare(current, useStrongComparison: false) || tag.Equals(EntityTagHeaderValue.Any))
            ? Results.StatusCode(StatusCodes.Status304NotModified)
            : Results.Bytes(body, "application/json");
    }

    /// <summary>A strong validator of this baby's exact answer: SHA-256 of the baby id, the release row id and the body, 128 bits in hex.</summary>
    internal static string ETagOf(Guid babyId, Guid? releaseRowId, byte[] body)
    {
        var input = new byte[32 + body.Length];
        babyId.TryWriteBytes(input.AsSpan(0, 16));
        (releaseRowId ?? Guid.Empty).TryWriteBytes(input.AsSpan(16, 16));
        body.CopyTo(input, 32);
        return $"\"cs-{Convert.ToHexStringLower(SHA256.HashData(input).AsSpan(0, 16))}\"";
    }
}
