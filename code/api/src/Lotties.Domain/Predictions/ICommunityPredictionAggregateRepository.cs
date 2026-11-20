namespace Lotties.Domain.Predictions;

/// <summary>
/// Read access to anonymized community prediction aggregates (docs/design/34-community-insights.md).
/// Implementations live in Infrastructure; this interface is pure and has no I/O dependencies beyond async cancellation.
/// Aggregates are keyed by (age band, event type, day phase); the repository returns the most recent non-suppressed aggregate
/// matching those dimensions, or <c>null</c> when none exists.
/// </summary>
public interface ICommunityPredictionAggregateRepository
{
    /// <summary>
    /// Returns the latest non-suppressed aggregate for the given dimensions, or <c>null</c> when no aggregate meets the
    /// minimum count threshold. Callers should treat <c>null</c> as "no community signal available" and fall back to
    /// published norms or personal-only predictions.
    /// </summary>
    Task<CommunityPredictionAggregate?> GetAggregateAsync(
        AgeBand ageBand,
        string typeKey,
        DayPhase? phase,
        CancellationToken cancellationToken = default);
}