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

    /// <summary>
    /// Computes the mean absolute error (MAE) in minutes for resolved outcomes of a baby and event type,
    /// optionally filtered by age band and day phase. Returns null when fewer than <paramref name="minSamples"/>
    /// resolved outcomes exist for the bucket. Used to derive accuracy-based weight adjustments for BlendedPrior.
    /// </summary>
    Task<double?> GetMaeAsync(Guid babyId, EventTypeKey typeKey, AgeBand? ageBand, DayPhase? phase, int minSamples, CancellationToken cancellationToken = default);

    /// <summary>
    /// Removes any resolved prediction outcome whose anchor matches <paramref name="oldAnchorAt"/> for the given
    /// baby and event type. Called when a parent retrospectively corrects an event's start time so the stale
    /// outcome (computed against the wrong timestamp) does not pollute accuracy metrics. Pending outcomes are
    /// left untouched because they have not yet been scored.
    /// </summary>
    Task InvalidateByAnchorAsync(Guid babyId, EventTypeKey typeKey, DateTimeOffset oldAnchorAt, CancellationToken cancellationToken = default);
}