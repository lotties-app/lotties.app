namespace Lotties.Domain.Predictions;

/// <summary>
/// An anonymized aggregate of prediction accuracy for a specific (age band, event type, day phase, temporal bucket) combination.
/// Contains no baby_id or personally identifiable information. Only cells of at least 20 consenting babies from 20 families that no
/// family dominates are stored, to prevent re-identification through small-cell attacks.
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
    /// Minimum number of resolved outcomes in a stored cell: a floor the reader also checks. It is not the privacy gate on its own
    /// (one baby can have many outcomes): the aggregator stores a cell only with at least 20 distinct babies from 20 distinct families
    /// and no family over the dominance threshold of the community statistics (docs/design/33-privacy-audit.md section 20.1).
    /// </summary>
    public const int MinimumCount = 10;

    /// <summary>Mean absolute error in minutes, derived from <see cref="SumErrorMinutes"/> / <see cref="Count"/>.</summary>
    public double MaeMinutes => Count > 0 ? SumErrorMinutes / Count : 0.0;

    /// <summary>Whether this aggregate meets the suppression threshold and can be safely exposed.</summary>
    public bool IsSuppressed => Count < MinimumCount;
}