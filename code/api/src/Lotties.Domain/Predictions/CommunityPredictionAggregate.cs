namespace Lotties.Domain.Predictions;

/// <summary>
/// An anonymized aggregate of prediction accuracy for a specific (age band, event type, day phase, temporal bucket) combination.
/// Contains no baby_id or personally identifiable information. Only aggregates meeting the minimum suppression threshold
/// (<see cref="MinimumCount"/>) are stored to prevent re-identification through small-cell attacks.
/// </summary>
/// <remarks>
/// This is a pure domain value object with no I/O. The persistence entity lives in Infrastructure.
/// Used as a community prior source for <see cref="BlendedPrior.Blend"/> via the optional <c>accuracyAdjustment</c> parameter.
/// </remarks>
public sealed record CommunityPredictionAggregate(
    AgeBand AgeBand,
    string TypeKey,
    DayPhase? Phase,
    string TemporalBucket,
    string EngineVersion,
    int Count,
    double SumErrorMinutes,
    double SumSquaredError,
    double? MedianErrorMinutes,
    double? P10ErrorMinutes,
    double? P90ErrorMinutes,
    DateTimeOffset GeneratedAtUtc)
{
    /// <summary>
    /// Minimum number of resolved outcomes required to store an aggregate. Cells below this threshold are suppressed
    /// to prevent re-identification: with fewer than 10 contributions, an individual baby's data could dominate the cell
    /// and be reverse-engineered from successive releases. This constant is the single source of truth for the privacy gate;
    /// the aggregation service and any query-time filter must both enforce it.
    /// </summary>
    public const int MinimumCount = 10;

    /// <summary>Mean absolute error in minutes, derived from <see cref="SumErrorMinutes"/> / <see cref="Count"/>.</summary>
    public double MaeMinutes => Count > 0 ? SumErrorMinutes / Count : 0.0;

    /// <summary>Whether this aggregate meets the suppression threshold and can be safely exposed.</summary>
    public bool IsSuppressed => Count < MinimumCount;
}