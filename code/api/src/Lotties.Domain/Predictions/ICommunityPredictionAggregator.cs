namespace Lotties.Domain.Predictions;

/// <summary>
/// Aggregates resolved prediction outcomes into anonymized community aggregates.
/// Implementations live in Infrastructure (they need database access); this interface is pure.
/// The aggregation reads from prediction_outcomes (which ARE linked to babies), groups by dimensions,
/// applies the suppression threshold, and writes to community_prediction_aggregates (which contain NO baby_id or PII).
/// </summary>
public interface ICommunityPredictionAggregator
{
    /// <summary>
    /// Runs the aggregation pipeline. Returns the number of aggregates written or updated.
    /// Safe to call repeatedly for the same temporal bucket (upsert semantics).
    /// </summary>
    Task<int> AggregateAsync(CancellationToken cancellationToken = default);
}