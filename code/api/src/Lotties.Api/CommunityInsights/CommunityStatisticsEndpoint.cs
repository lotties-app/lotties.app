using Lotties.Application.Babies;
using Lotties.Application.CommunityInsights;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Users;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Lotties.Api.CommunityInsights;

/// <summary>
/// The community statistics serving endpoint (docs/design/34-community-insights.md section 5, task T6): one route per statistic key,
/// filtered to the caller's baby's age band from the latest active release. Facts only, never advice; nothing identifies any baby or
/// family. Requires authentication, an active community insights consent on at least one of the caller's babies, and the feature flag
/// <c>CommunityInsights:Enabled</c> (the guard answers a bare 404 while it is off). Demo accounts are excluded. Doctors are refused:
/// community statistics are family-level, not clinical. Rate limited per user per hour. The route has no <c>{babyId}</c>, so no baby
/// policy can decide it (a baby policy fails every caller on such a route): the handler counts only the babies on which the caller
/// holds a family role (<see cref="BabyRoleRules.CanReadFamilyRecords"/>), so a Doctor's patients never open it.
/// </summary>
internal static class CommunityStatisticsEndpoint
{
    public const string Path = "/community/statistics/{statisticKey}";

    /// <summary>The response may be cached privately for five minutes (release changes weekly); then a client revalidates.</summary>
    private const string CacheControl = "private, max-age=300";

    /// <summary>Maps <c>GET /community/statistics/{statisticKey}</c>.</summary>
    public static IEndpointRouteBuilder MapCommunityStatisticsEndpoint(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        api.MapGet(Path, GetAsync)
            .WithMetadata(CommunityInsightsEndpointMetadata.Instance)
            .RequireRateLimiting(Limits.RequestLimitPolicies.CommunityStatisticsRead)
            .WithName("GetCommunityStatistics")
            .Produces<CommunityStatisticsResponse>(StatusCodes.Status200OK, contentType: "application/json")
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);
        return api;
    }

    private static async Task<IResult> GetAsync(
        string statisticKey,
        HttpContext http,
        ICurrentUser currentUser,
        IBabyService babies,
        ICommunityConsentRepository consents,
        ICommunityStatisticsReleaseRepository releases,
        ICommunityStatisticsCatalogProvider catalogProvider,
        TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        var user = await currentUser.GetUserAsync(cancellationToken);
        if (user.IsDemo)
        {
            throw new DemoNotAvailableException();
        }

        // Only the babies of the caller's family count: a Doctor's patients are listed too, and she never gets a pooled view
        // (docs/design/34-community-insights.md section 3.4).
        var callerBabies = (await babies.ListAsync(cancellationToken)).Where(baby => baby.Role.CanReadFamilyRecords()).ToArray();
        if (callerBabies.Length == 0)
        {
            return Results.Problem(statusCode: StatusCodes.Status403Forbidden, detail: "No baby membership.");
        }

        // Find the first baby with active community insights consent.
        Guid? consentedBabyId = null;
        foreach (var baby in callerBabies)
        {
            var history = await consents.HistoryAsync(baby.Id, cancellationToken);
            if (history.IsInForce)
            {
                consentedBabyId = baby.Id;
                break;
            }
        }

        if (consentedBabyId is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status403Forbidden, detail: "No active community insights consent on any of your babies.");
        }

        var release = await releases.GetActiveAsync(cancellationToken);
        if (release is null)
        {
            return Results.NotFound(new { error = "no_release", detail = "No community statistics release is available yet." });
        }

        var catalog = catalogProvider.Catalog;
        var statistic = catalog.Statistics.FirstOrDefault(s => string.Equals(s.Key, statisticKey, StringComparison.Ordinal));
        if (statistic is null)
        {
            return Results.NotFound(new { error = "unknown_statistic", detail = $"Unknown statistic key '{statisticKey}'." });
        }

        // Compute the caller's baby's age band from birth date.
        var consentedBaby = callerBabies.First(b => b.Id == consentedBabyId.Value);
        var ageWeeks = ComputeAgeWeeks(consentedBaby.BirthDate, timeProvider.GetUtcNow());
        var band = CommunityBandGrid.BandOf(CommunityBandGrid.FineBands(catalog.BandGrids, statistic.Band.Grid), ageWeeks);
        if (band is null)
        {
            return Results.NotFound(new { error = "no_band", detail = "No age band matches this baby's age for this statistic." });
        }

        // The cell for this statistic and age: her fine cell, else the coarse fallback holding her age (statistics without a dimension;
        // a statistic with a dimension and the whole cell are served by the endpoint rewrite, task T6).
        var cell = ReadRelease(release.StatisticsJson).CellFor(statisticKey, ageWeeks, dimension: null);

        var etag = $"\"{release.ReleaseId}:{statisticKey}\"";
        http.Response.Headers.ETag = etag;
        http.Response.Headers.CacheControl = CacheControl;

        var requested = http.Request.GetTypedHeaders().IfNoneMatch;
        var current = new EntityTagHeaderValue(etag);
        if (requested.Any(tag => tag.Compare(current, useStrongComparison: false) || tag.Equals(EntityTagHeaderValue.Any)))
        {
            return Results.StatusCode(StatusCodes.Status304NotModified);
        }

        var response = BuildResponse(statistic, cell, band.Value, release.GeneratedAtUtc);
        return Results.Ok(response);
    }

    private static int ComputeAgeWeeks(DateOnly birthDate, DateTimeOffset now)
    {
        var birth = new DateTimeOffset(birthDate.Year, birthDate.Month, birthDate.Day, 0, 0, 0, TimeSpan.Zero);
        var days = (int)(now.Date - birth.Date).TotalDays;
        return Math.Max(0, days / 7);
    }

    /// <summary>The served release; one that cannot be read (a phase-1 placeholder row, a damaged row) has no cells, so nothing is served from it.</summary>
    private static CommunityRelease ReadRelease(string statisticsJson)
    {
        try
        {
            return CommunityReleaseJson.Parse(statisticsJson);
        }
        catch (FormatException)
        {
            return CommunityRelease.Placeholder(DateTimeOffset.UnixEpoch, catalogVersion: 0);
        }
    }

    /// <summary>
    /// The single-value response of this endpoint: the cell's value when it has exactly one (a scalar share), else none; the group size
    /// bucket as published. A cell below the thresholds is absent from the release, so it reads as <c>no_data</c>.
    /// </summary>
    private static CommunityStatisticsResponse BuildResponse(CommunityStatistic statistic, CommunityReleaseCell? cell, CommunityBand band, DateTimeOffset releasedAtUtc)
    {
        if (cell is null)
        {
            return new CommunityStatisticsResponse
            {
                StatisticKey = statistic.Key,
                AgeBandLabel = FormatBandLabel(band),
                Value = null,
                SampleSizeRange = string.Empty,
                Confidence = string.Empty,
                ReleasedAtUtc = releasedAtUtc,
                SuppressionReason = "no_data",
            };
        }

        return new CommunityStatisticsResponse
        {
            StatisticKey = statistic.Key,
            AgeBandLabel = FormatBandLabel(cell.Band),
            Value = cell.Outputs.Count == 1 ? cell.Outputs.Values.Single() : null,
            SampleSizeRange = CommunityGroupSizes.ToWire(cell.Babies),
            Confidence = FormatConfidence(cell.Babies),
            ReleasedAtUtc = releasedAtUtc,
            SuppressionReason = null,
        };
    }

    private static string FormatBandLabel(CommunityBand band) =>
        string.Create(System.Globalization.CultureInfo.InvariantCulture, $"{band.FromWeeks}-{band.ToWeeks}w");

    private static string FormatConfidence(CommunityGroupSize babies) => babies switch
    {
        CommunityGroupSize.Babies100Plus => "high",
        CommunityGroupSize.Babies50To99 => "moderate",
        _ => "low",
    };
}