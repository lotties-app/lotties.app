using Lotties.Domain.CommunityInsights;

namespace Lotties.Application.CommunityInsights;

/// <summary>
/// <c>GET /babies/{babyId}/community-statistics</c> (docs/design/34-community-insights.md section 6 "Serving"): every v1 community
/// statistic for that baby's age, from the active release. Facts only, never advice; no exact count, no noise budget, no reason a cell is
/// missing, nothing that identifies a baby or a family.
/// </summary>
/// <param name="State">
/// <c>not_yet</c> (no release to serve: none yet, a placeholder, one that cannot be read, or one of another catalog version; the other
/// fields are null and the list empty) or <c>available</c>.
/// </param>
/// <param name="GeneratedAt">When the served release was generated, UTC.</param>
/// <param name="PreviousQuarter">The days the <c>previous_quarter</c> statistics read: the calendar quarter before the release's own (UTC).</param>
/// <param name="Statistics">Every v1 statistic of the catalog, in catalog order; one without a cell for this baby has <c>cell: null</c>.</param>
public sealed record CommunityStatisticsResponse(
    string State,
    DateTimeOffset? GeneratedAt,
    CommunityDataPeriodResponse? PreviousQuarter,
    IReadOnlyList<CommunityStatisticResponse> Statistics)
{
    public const string NotYet = "not_yet";

    public const string Available = "available";

    public static CommunityStatisticsResponse NothingYet { get; } = new(NotYet, null, null, []);

    public static CommunityStatisticsResponse From(CommunityServedView view)
    {
        ArgumentNullException.ThrowIfNull(view);
        return new CommunityStatisticsResponse(
            Available,
            view.GeneratedAt,
            new CommunityDataPeriodResponse(view.PreviousQuarter.From, view.PreviousQuarter.To),
            [.. view.Statistics.Select(CommunityStatisticResponse.From)]);
    }
}

/// <summary>A span of calendar days, both included (ISO dates).</summary>
public sealed record CommunityDataPeriodResponse(DateOnly From, DateOnly To);

/// <summary>
/// One statistic for the baby. <paramref name="Period"/>: <c>previous_quarter</c> (each contributing baby's days of
/// <see cref="CommunityStatisticsResponse.PreviousQuarter"/> only) or <c>since_consent</c> (all her days since her consent).
/// </summary>
public sealed record CommunityStatisticResponse(string Key, string Period, CommunityCellResponse? Cell)
{
    public const string PreviousQuarterPeriod = "previous_quarter";

    public const string SinceConsentPeriod = "since_consent";

    public static CommunityStatisticResponse From(CommunityServedStatistic statistic)
    {
        ArgumentNullException.ThrowIfNull(statistic);
        return new CommunityStatisticResponse(
            statistic.Key,
            statistic.Period == CommunityStatisticPeriod.PreviousQuarter ? PreviousQuarterPeriod : SinceConsentPeriod,
            statistic.Cell is { } cell ? CommunityCellResponse.From(cell) : null);
    }
}

/// <summary>
/// The baby's cell of a statistic: the age band actually served in completed weeks (her fine band, or the coarser fallback holding her
/// age), the group size bucket as published (<c>"20-49"</c>, <c>"50-99"</c> or <c>"100+"</c>, never a count) and the named values
/// (<c>p25</c>, <c>p50</c>, <c>p75</c>; <c>share_of_days_with_any</c>; <c>share_helped_by_cause.&lt;cause&gt;</c>), in name order.
/// </summary>
public sealed record CommunityCellResponse(CommunityBandResponse Band, string GroupSize, IReadOnlyDictionary<string, decimal> Values)
{
    public static CommunityCellResponse From(CommunityServedCell cell)
    {
        ArgumentNullException.ThrowIfNull(cell);
        return new CommunityCellResponse(
            new CommunityBandResponse(cell.Band.FromWeeks, cell.Band.ToWeeks),
            CommunityGroupSizes.ToWire(cell.GroupSize),
            new SortedDictionary<string, decimal>(cell.Values.ToDictionary(StringComparer.Ordinal), StringComparer.Ordinal));
    }
}

/// <summary>An age band in completed weeks, <paramref name="FromWeeks"/> inclusive to <paramref name="ToWeeks"/> exclusive.</summary>
public sealed record CommunityBandResponse(int FromWeeks, int ToWeeks);

/// <summary>What the service answers: the response and the id of the release row it was read from (null when none), for the validator.</summary>
public sealed record CommunityStatisticsAnswer(CommunityStatisticsResponse Response, Guid? ReleaseRowId);
