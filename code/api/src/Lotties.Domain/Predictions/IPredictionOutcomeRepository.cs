using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>Read/write access to prediction outcomes used for accuracy tracking and feedback loops.</summary>
internal interface IPredictionOutcomeRepository
{
    /// <summary>Persists a prediction outcome (pending or resolved).</summary>
    Task SaveAsync(PredictionOutcome outcome, CancellationToken cancellationToken = default);

    /// <summary>Returns unresolved outcomes for a baby and event type, awaiting the next actual event.</summary>
    Task<IReadOnlyList<PredictionOutcome>> GetPendingAsync(Guid babyId, EventTypeKey typeKey, CancellationToken cancellationToken = default);

    /// <summary>Returns the most recent resolved outcomes for a baby and event type, ordered newest first.</summary>
    Task<IReadOnlyList<PredictionOutcome>> GetResolvedAsync(Guid babyId, EventTypeKey typeKey, int limit, CancellationToken cancellationToken = default);
}