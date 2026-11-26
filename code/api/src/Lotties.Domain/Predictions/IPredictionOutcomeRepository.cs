using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>Read/write access to prediction outcomes used for accuracy tracking and feedback loops.</summary>
internal interface IPredictionOutcomeRepository
{
    /// <summary>Persists a prediction outcome (pending, resolved or expired).</summary>
    Task SaveAsync(PredictionOutcome outcome, CancellationToken cancellationToken = default);

    /// <summary>Returns unresolved outcomes for a baby and event type, awaiting the next actual event (expired ones excluded), oldest first.</summary>
    Task<IReadOnlyList<PredictionOutcome>> GetPendingAsync(Guid babyId, EventTypeKey typeKey, CancellationToken cancellationToken = default);

    /// <summary>Returns the most recent resolved outcomes for a baby and event type, ordered newest first.</summary>
    Task<IReadOnlyList<PredictionOutcome>> GetResolvedAsync(Guid babyId, EventTypeKey typeKey, int limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// Computes the mean absolute error (MAE) in minutes for resolved outcomes of a baby and event type,
    /// optionally filtered by age band and day phase. Returns null when fewer than <paramref name="minSamples"/>
    /// resolved outcomes exist for the bucket. Expired outcomes (no error) never count. Used to derive accuracy-based
    /// weight adjustments for BlendedPrior.
    /// </summary>
    Task<double?> GetMaeAsync(Guid babyId, EventTypeKey typeKey, AgeBand? ageBand, DayPhase? phase, int minSamples, CancellationToken cancellationToken = default);

    /// <summary>
    /// Removes any resolved prediction outcome whose anchor matches <paramref name="oldAnchorAt"/> for the given
    /// baby and event type. Called when a parent retrospectively corrects an event's start time so the stale
    /// outcome (computed against the wrong timestamp) does not pollute accuracy metrics. Pending outcomes are
    /// left untouched because they have not yet been scored.
    /// </summary>
    Task InvalidateByAnchorAsync(Guid babyId, EventTypeKey typeKey, DateTimeOffset oldAnchorAt, CancellationToken cancellationToken = default);

    /// <summary>Whether an outcome (in any state) is already recorded for this baby, type and anchor: one estimate per anchor is kept.</summary>
    Task<bool> ExistsForAnchorAsync(Guid babyId, EventTypeKey typeKey, DateTimeOffset anchorAt, CancellationToken cancellationToken = default);

    /// <summary>
    /// The outcomes an event of this type starting at <paramref name="eventStart"/> may resolve (see
    /// <see cref="PredictionOutcome.IsResolvableBy"/>): not expired, anchored before the event, and pending or resolved by a later event.
    /// </summary>
    Task<IReadOnlyList<PredictionOutcome>> GetResolvableByAsync(Guid babyId, EventTypeKey typeKey, DateTimeOffset eventStart, CancellationToken cancellationToken = default);

    /// <summary>
    /// Stores the actual next start and error of <paramref name="resolved"/> only when the stored row is still pending or holds a
    /// later actual next start (one conditional write, so concurrent resolutions keep the earliest event whatever their order).
    /// Returns whether the row was written.
    /// </summary>
    Task<bool> TryResolveAsync(PredictionOutcome resolved, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes the resolved and expired outcomes of a baby and event type predicted before <paramref name="cutoff"/> (retention,
    /// <see cref="PredictionOptions.OutcomeRetentionDays"/>); pending ones are kept. Returns how many were deleted.
    /// </summary>
    Task<int> DeleteClosedBeforeAsync(Guid babyId, EventTypeKey typeKey, DateTimeOffset cutoff, CancellationToken cancellationToken = default);
}
