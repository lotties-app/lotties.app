namespace Lotties.Application.CommunityInsights;

/// <summary>
/// One cell of the community statistics response (docs/design/34-community-insights.md section 5): facts only, never advice.
/// The value is a noisy aggregate (mean, share or percentile) for the caller's baby's age band; nothing identifies any baby
/// or family. A suppressed cell carries no value and explains why (privacy threshold not met, family dominance, etc.).
/// </summary>
public sealed record CommunityStatisticsResponse
{
    /// <summary>The statistic key as defined in the catalog (e.g. <c>sleep_night_mean</c>).</summary>
    public string StatisticKey { get; init; } = string.Empty;

    /// <summary>
    /// The age band label the value applies to (e.g. <c>8-12w</c>, <c>3-6m</c>). Derived from the caller's baby's birth date
    /// and the catalog's band grid; the same request always resolves to the same band while the release is active.
    /// </summary>
    public string AgeBandLabel { get; init; } = string.Empty;

    /// <summary>
    /// The noisy aggregate value for this band, or <c>null</c> when the cell is suppressed (see <see cref="SuppressionReason"/>).
    /// Facts only: a mean, share or percentile, never a recommendation or interpretation.
    /// </summary>
    public decimal? Value { get; init; }

    /// <summary>
    /// The published group-size bucket of distinct babies behind this cell (<c>"20-49"</c>, <c>"50-99"</c> or <c>"100+"</c>,
    /// <see cref="Lotties.Domain.CommunityInsights.CommunityGroupSizes"/>). Never an exact count. Empty when the cell is absent.
    /// </summary>
    public string SampleSizeRange { get; init; } = string.Empty;

    /// <summary>
    /// Confidence indicator derived from sample size and noise budget (e.g. <c>"high"</c>, <c>"moderate"</c>, <c>"low"</c>).
    /// Facts only: describes statistical precision, never clinical reliability.
    /// </summary>
    public string Confidence { get; init; } = string.Empty;

    /// <summary>When the release containing this value was generated, UTC.</summary>
    public DateTimeOffset ReleasedAtUtc { get; init; }

    /// <summary>
    /// Why the cell has no value, or <c>null</c> when a value is present. Values include <c>"no_data"</c> (no contributions
    /// for this band yet), <c>"below_threshold"</c> (fewer than k distinct babies), <c>"family_dominance"</c> (one family
    /// contributed too much) or another reason from the aggregator. Never names a baby or family.
    /// </summary>
    public string? SuppressionReason { get; init; }
}

/// <summary>
/// The result of looking up a community statistic for the caller's baby: either a response with a value or suppression reason,
/// or <c>null</c> when no active release exists yet (the feature is enabled but the first aggregation has not completed).
/// </summary>
public sealed record CommunityStatisticsLookupResult(CommunityStatisticsResponse? Response, bool ReleaseExists);