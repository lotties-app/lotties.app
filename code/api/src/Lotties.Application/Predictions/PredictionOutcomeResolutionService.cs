using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Predictions;

/// <summary>
/// Records prediction outcomes for accuracy tracking and resolves pending outcomes when actual events arrive.
/// Only operates when <see cref="PredictionOptions.AccuracyTrackingEnabled"/> is true.
/// </summary>
internal sealed class PredictionOutcomeResolutionService(
    IPredictionOutcomeRepository repository,
    PredictionOptions options,
    ILogger<PredictionOutcomeResolutionService> logger)
{
    /// <summary>
    /// Records a prediction as a pending outcome for later resolution against the actual next event.
    /// Enforces <see cref="PredictionOptions.MaxPendingOutcomes"/> by dropping the oldest pending outcome if exceeded.
    /// </summary>
    public async Task RecordPredictionAsync(
        Prediction prediction, Guid babyId, string engineVersion, CancellationToken cancellationToken = default)
    {
        if (!options.AccuracyTrackingEnabled)
        {
            return;
        }

        try
        {
            var outcome = new PredictionOutcome(
                babyId,
                prediction.TypeKey,
                prediction.AnchorAt,
                prediction.AnchorAt,
                prediction.NextStart.Expected,
                null,
                null,
                engineVersion,
                prediction.SampleCount,
                prediction.Reason.AgeBand,
                prediction.Reason.Phase);

            await repository.SaveAsync(outcome, cancellationToken);

            // Enforce max pending outcomes per baby per type.
            var pending = await repository.GetPendingAsync(babyId, prediction.TypeKey, cancellationToken);
            if (pending.Count > options.MaxPendingOutcomes)
            {
                var excess = pending.Take(pending.Count - options.MaxPendingOutcomes).ToArray();
                foreach (var old in excess)
                {
                    // Resolve with the expected time itself so it no longer counts as pending;
                    // this is a cleanup, not a real measurement.
                    var resolved = old.Resolve(old.ExpectedNextStart);
                    await repository.SaveAsync(resolved, cancellationToken);
                }

                logger.LogDebug(
                    "Dropped {DroppedCount} oldest pending prediction outcomes for baby {BabyId} type {TypeKey} (limit {Limit})",
                    excess.Length,
                    babyId,
                    prediction.TypeKey.Value,
                    options.MaxPendingOutcomes);
            }
        }
        catch (Exception ex)
        {
            // Fire-and-forget: never let outcome recording break the prediction response.
            logger.LogError(ex, "Failed to record prediction outcome for baby {BabyId} type {TypeKey}", babyId, prediction.TypeKey.Value);
        }
    }

    /// <summary>
    /// Resolves the oldest pending outcome for a baby and event type with the actual next start time.
    /// Called when a new event of the predicted type arrives.
    /// </summary>
    public async Task ResolvePendingAsync(
        Guid babyId, EventTypeKey typeKey, DateTimeOffset actualNextStart, CancellationToken cancellationToken = default)
    {
        if (!options.AccuracyTrackingEnabled)
        {
            return;
        }

        try
        {
            var pending = await repository.GetPendingAsync(babyId, typeKey, cancellationToken);
            if (pending.Count == 0)
            {
                return;
            }

            // Resolve the oldest pending outcome (first in chronological order).
            var oldest = pending[0];
            var resolved = oldest.Resolve(actualNextStart);
            await repository.SaveAsync(resolved, cancellationToken);

            logger.LogDebug(
                "Resolved prediction outcome for baby {BabyId} type {TypeKey}: error {ErrorMinutes:F1} min",
                babyId,
                typeKey.Value,
                resolved.ErrorMinutes);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to resolve prediction outcome for baby {BabyId} type {TypeKey}", babyId, typeKey.Value);
        }
    }
}