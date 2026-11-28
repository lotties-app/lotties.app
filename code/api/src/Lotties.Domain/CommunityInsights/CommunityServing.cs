namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// The minimum group size a published cell needs to be served to the app, per statistic (owner decision, docs/design/34-community-insights.md
/// section 6 "Serving"): on top of the release's own k (20 babies from 20 families), a statistic whose noise at small groups makes it
/// worse than a guess is served only from a larger group. A statistic not listed here is served from any published cell. A withheld
/// cell is served exactly as an absent one (no cell, no reason), and the coarse fallback is looked up as if it were absent.
/// </summary>
/// <remarks>
/// The one place to change these values. Crying (<c>cry_outcome_by_cause</c>): the built mechanism gives about 17 points of error per
/// cause at 20 babies, 9 at 50 and 5 at 100, against about 7 for a uniform guess (design 34 section 5.1.1, item 2), so it is served only
/// from a "100+" cell.
/// </remarks>
public static class CommunityServingThresholds
{
    /// <summary>The smallest group size bucket served, by statistic key.</summary>
    public static IReadOnlyDictionary<string, CommunityGroupSize> MinimumGroupSize { get; } = new Dictionary<string, CommunityGroupSize>(StringComparer.Ordinal)
    {
        ["cry_outcome_by_cause"] = CommunityGroupSize.Babies100Plus,
    };

    /// <summary>Whether <paramref name="cell"/> is large enough to be served.</summary>
    public static bool MayServe(CommunityReleaseCell cell)
    {
        ArgumentNullException.ThrowIfNull(cell);
        return !MinimumGroupSize.TryGetValue(cell.Statistic, out var minimum) || cell.Babies >= minimum;
    }
}

/// <summary>Which days of each contributing baby a statistic is computed from.</summary>
public enum CommunityStatisticPeriod
{
    /// <summary>Only the previous calendar quarter of the release (the percentile statistics, <see cref="CommunityDataWindow.PreviousQuarterOf"/>).</summary>
    PreviousQuarter,

    /// <summary>Every day since each contributing baby's consent in force (the share statistics; design 34 section 5.3).</summary>
    SinceConsent,
}

/// <summary>A served cell: the band actually served (fine, or the coarse fallback), the group size bucket as published and the named values.</summary>
public sealed record CommunityServedCell(CommunityBand Band, CommunityGroupSize GroupSize, IReadOnlyDictionary<string, decimal> Values);

/// <summary>One v1 statistic for one baby: its period and her cell, or none (absent, below a serving threshold, or no age).</summary>
public sealed record CommunityServedStatistic(string Key, CommunityStatisticPeriod Period, CommunityServedCell? Cell);

/// <summary>
/// What one baby is served of a release: when it was generated, the days its percentile statistics read (the previous calendar quarter
/// of <see cref="GeneratedAt"/>), and every v1 statistic of the catalog with her cell or none, in catalog order.
/// </summary>
public sealed record CommunityServedView(DateTimeOffset GeneratedAt, CommunityDataWindow PreviousQuarter, IReadOnlyList<CommunityServedStatistic> Statistics);

/// <summary>
/// Picks what one baby is served of a release (docs/design/34-community-insights.md section 6 "Serving"); pure, no I/O. For each v1
/// statistic of the catalog (an output not marked <c>notInV1</c>): the cell of her age in completed weeks, her fine cell when published,
/// else the narrowest published (coarse) cell holding her age (<see cref="CommunityRelease.CellFor"/>), after the serving thresholds
/// (<see cref="CommunityServingThresholds"/>), with only its v1 values. No count, no epsilon, no reason a cell is missing.
/// </summary>
public static class CommunityServing
{
    /// <summary>
    /// The view of <paramref name="release"/> for a baby of <paramref name="ageWeeks"/> completed weeks (<c>null</c>: not born yet, so no
    /// cells). <c>null</c> when the release is not served: a placeholder, or one computed from another catalog version (its periods and
    /// outputs may not be the current catalog's).
    /// </summary>
    public static CommunityServedView? ViewFor(CommunityRelease release, CommunityStatisticsCatalog catalog, int? ageWeeks)
    {
        ArgumentNullException.ThrowIfNull(release);
        ArgumentNullException.ThrowIfNull(catalog);
        if (release.IsPlaceholder || release.CatalogVersion != catalog.Version)
        {
            return null;
        }

        var served = release with { Cells = [.. release.Cells.Where(CommunityServingThresholds.MayServe)] };
        return new CommunityServedView(
            release.GeneratedAt,
            CommunityDataWindow.PreviousQuarterOf(release.GeneratedAt),
            [.. catalog.InV1.Select(statistic => new CommunityServedStatistic(statistic.Key, PeriodOf(statistic), CellOf(served, statistic, ageWeeks)))]);
    }

    /// <summary>The period of <paramref name="statistic"/>: the previous quarter for a windowed (percentile) statistic, else since the consent.</summary>
    public static CommunityStatisticPeriod PeriodOf(CommunityStatistic statistic)
    {
        ArgumentNullException.ThrowIfNull(statistic);
        return statistic.Window == CommunityStatisticsAggregator.PreviousQuarterWindow ? CommunityStatisticPeriod.PreviousQuarter : CommunityStatisticPeriod.SinceConsent;
    }

    /// <summary>
    /// Her cell of a statistic without a dimension. No v1 statistic has a dimension (a test holds it); one that gets one is served no
    /// cell until the answer says which dimension value a cell is for.
    /// </summary>
    private static CommunityServedCell? CellOf(CommunityRelease served, CommunityStatistic statistic, int? ageWeeks)
    {
        if (ageWeeks is not { } age || statistic.Band.Dimension is not null)
        {
            return null;
        }

        var cell = served.CellFor(statistic.Key, age, dimension: null);
        if (cell is null)
        {
            return null;
        }

        var v1 = statistic.V1Outputs.Select(output => output.Name).ToHashSet(StringComparer.Ordinal);
        var values = new SortedDictionary<string, decimal>(
            cell.Outputs.Where(value => v1.Contains(CommunityReleaseCell.OutputOf(value.Key))).ToDictionary(StringComparer.Ordinal),
            StringComparer.Ordinal);
        return values.Count == 0 ? null : new CommunityServedCell(cell.Band, cell.Babies, values);
    }
}
