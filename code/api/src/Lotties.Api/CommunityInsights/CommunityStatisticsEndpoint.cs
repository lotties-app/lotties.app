using System.Text.Json;
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
        var bandKey = ResolveBandKey(statistic, catalog.BandGrids, ageWeeks);
        if (bandKey is null)
        {
            return Results.NotFound(new { error = "no_band", detail = "No age band matches this baby's age for this statistic." });
        }

        // Parse the release JSON and find the cell for this statistic + band.
        var cells = ParseCells(release.StatisticsJson);
        var cell = cells.FirstOrDefault(c =>
            string.Equals(c.StatisticKey, statisticKey, StringComparison.Ordinal) &&
            string.Equals(c.BandKey, bandKey, StringComparison.Ordinal));

        var etag = $"\"{release.ReleaseId}:{statisticKey}\"";
        http.Response.Headers.ETag = etag;
        http.Response.Headers.CacheControl = CacheControl;

        var requested = http.Request.GetTypedHeaders().IfNoneMatch;
        var current = new EntityTagHeaderValue(etag);
        if (requested.Any(tag => tag.Compare(current, useStrongComparison: false) || tag.Equals(EntityTagHeaderValue.Any)))
        {
            return Results.StatusCode(StatusCodes.Status304NotModified);
        }

        var response = BuildResponse(statistic, cell, bandKey, release.GeneratedAtUtc);
        return Results.Ok(response);
    }

    private static int ComputeAgeWeeks(DateOnly birthDate, DateTimeOffset now)
    {
        var birth = new DateTimeOffset(birthDate.Year, birthDate.Month, birthDate.Day, 0, 0, 0, TimeSpan.Zero);
        var days = (int)(now.Date - birth.Date).TotalDays;
        return Math.Max(0, days / 7);
    }

    private static string? ResolveBandKey(CommunityStatistic statistic, CommunityBandGrids grids, int ageWeeks)
    {
        // Use fine grid first, fall back to coarse.
        var gridName = statistic.Band.Grid;
        var segments = string.Equals(gridName, "age_weeks_coarse", StringComparison.Ordinal)
            ? grids.AgeWeeksCoarse
            : grids.AgeWeeksFine;

        foreach (var segment in segments)
        {
            if (ageWeeks >= segment.FromWeeks && ageWeeks < segment.ToWeeks)
            {
                // Band key is the lower edge in weeks (e.g. "8" for 8-12w).
                return segment.FromWeeks.ToString(System.Globalization.CultureInfo.InvariantCulture);
            }
        }

        return null;
    }

    private static IReadOnlyList<AggregatedCell> ParseCells(string statisticsJson)
    {
        try
        {
            using var document = JsonDocument.Parse(statisticsJson);
            var root = document.RootElement;
            if (!root.TryGetProperty("cells", out var cellsElement) || cellsElement.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            var cells = new List<AggregatedCell>();
            foreach (var cellElement in cellsElement.EnumerateArray())
            {
                var key = cellElement.GetProperty("statisticKey").GetString() ?? string.Empty;
                var bandKey = cellElement.GetProperty("bandKey").GetString() ?? string.Empty;
                var dimensionValue = cellElement.TryGetProperty("dimensionValue", out var dimProp) && dimProp.ValueKind == JsonValueKind.String
                    ? dimProp.GetString()
                    : null;
                var distinctBabies = cellElement.GetProperty("distinctBabies").GetInt32();
                var distinctFamilies = cellElement.GetProperty("distinctFamilies").GetInt32();
                var mean = cellElement.GetProperty("mean").GetDecimal();
                decimal? p3 = cellElement.TryGetProperty("p3", out var p3Prop) && p3Prop.ValueKind == JsonValueKind.Number
                    ? p3Prop.GetDecimal()
                    : null;
                decimal? p97 = cellElement.TryGetProperty("p97", out var p97Prop) && p97Prop.ValueKind == JsonValueKind.Number
                    ? p97Prop.GetDecimal()
                    : null;
                var suppressed = cellElement.GetProperty("suppressed").GetBoolean();
                var suppressionReason = cellElement.TryGetProperty("suppressionReason", out var reasonProp) && reasonProp.ValueKind == JsonValueKind.String
                    ? reasonProp.GetString()
                    : null;

                cells.Add(new AggregatedCell(key, bandKey, dimensionValue, distinctBabies, distinctFamilies, mean, p3, p97, suppressed, suppressionReason));
            }

            return cells;
        }
        catch
        {
            return [];
        }
    }

    private static CommunityStatisticsResponse BuildResponse(CommunityStatistic statistic, AggregatedCell? cell, string bandKey, DateTimeOffset releasedAtUtc)
    {
        if (cell is null)
        {
            return new CommunityStatisticsResponse
            {
                StatisticKey = statistic.Key,
                AgeBandLabel = FormatBandLabel(bandKey),
                Value = null,
                SampleSizeRange = string.Empty,
                Confidence = string.Empty,
                ReleasedAtUtc = releasedAtUtc,
                SuppressionReason = "no_data",
            };
        }

        if (cell.Suppressed)
        {
            return new CommunityStatisticsResponse
            {
                StatisticKey = statistic.Key,
                AgeBandLabel = FormatBandLabel(bandKey),
                Value = null,
                SampleSizeRange = string.Empty,
                Confidence = string.Empty,
                ReleasedAtUtc = releasedAtUtc,
                SuppressionReason = cell.SuppressionReason ?? "suppressed",
            };
        }

        return new CommunityStatisticsResponse
        {
            StatisticKey = statistic.Key,
            AgeBandLabel = FormatBandLabel(bandKey),
            Value = cell.Mean,
            SampleSizeRange = FormatSampleSizeRange(cell.DistinctFamilies),
            Confidence = FormatConfidence(cell.DistinctFamilies, statistic.Epsilon),
            ReleasedAtUtc = releasedAtUtc,
            SuppressionReason = null,
        };
    }

    private static string FormatBandLabel(string bandKey) => $"{bandKey}w";

    private static string FormatSampleSizeRange(int distinctFamilies) => distinctFamilies switch
    {
        < 20 => "<20",
        < 50 => "20-49",
        < 100 => "50-99",
        < 200 => "100-199",
        < 500 => "200-499",
        _ => "500+",
    };

    private static string FormatConfidence(int distinctFamilies, decimal epsilon)
    {
        // Simple heuristic: high when many families and reasonable epsilon, moderate for mid-range, low otherwise.
        if (distinctFamilies >= 100 && epsilon > 0.1m)
        {
            return "high";
        }

        if (distinctFamilies >= 50)
        {
            return "moderate";
        }

        return "low";
    }
}