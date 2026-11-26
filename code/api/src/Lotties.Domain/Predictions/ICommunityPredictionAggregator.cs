namespace Lotties.Domain.Predictions;

/// <summary>
/// Aggregates resolved prediction outcomes into anonymized community aggregates.
/// Implementations live in Infrastructure (they need database access); this interface is pure.
/// The aggregation reads prediction_outcomes (which ARE linked to babies) of babies with a current community consent only,
/// groups by dimensions, keeps cells of at least 20 babies from 20 families that no family dominates, and replaces
/// community_prediction_aggregates (which contain NO baby_id or PII). Not registered in DI (docs/design/33-privacy-audit.md section 20.1).
/// </summary>
public interface ICommunityPredictionAggregator
{
    /// <summary>
    /// Runs the aggregation pipeline. Returns the number of aggregates written or updated.
    /// Safe to call repeatedly: each run replaces the table, so a cell that no longer qualifies is removed.
    /// </summary>
    Task<int> AggregateAsync(CancellationToken cancellationToken = default);
}