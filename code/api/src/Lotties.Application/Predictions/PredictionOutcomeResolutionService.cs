using System.Globalization;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
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
    TimeProvider time,
    ILogger<PredictionOutcomeResolutionService> logger) : IPredictionOutcomeResolutionService
{
    /// <summary>How far the instant of an ISO 8601 feedback id may be from a stored expected next start and still name it.</summary>
    internal static readonly TimeSpan FeedbackMatchTolerance = TimeSpan.FromSeconds(1);

    /// <summary>
    /// Records a prediction as a pending outcome for later resolution against the actual next event, once per baby, type and
    /// anchor (a predictions answer for the same history records nothing new). Enforces
    /// <see cref="PredictionOptions.MaxPendingOutcomes"/> by expiring the oldest pending outcomes (closed without a measurement,
    /// never scored) and, when <see cref="PredictionOptions.OutcomeRetentionDays"/> is positive, deletes every outcome of this
    /// baby (all types and states) anchored more than that many days ago.
    /// When <paramref name="createdAt"/> is provided, flags the outcome as retrospective if the event was logged
    /// significantly after its own start time (see <see cref="FeedingPatternAnalyzer.IsRetrospectiveEntry"/>).
    /// </summary>
    public async Task RecordPredictionAsync(
        Prediction prediction, Guid babyId, string engineVersion, DateTimeOffset? createdAt = null, CancellationToken cancellationToken = default)
    {
        if (!options.AccuracyTrackingEnabled)
        {
            return;
        }

        try
        {
            if (await repository.ExistsForAnchorAsync(babyId, prediction.TypeKey, prediction.AnchorAt, cancellationToken))
            {
                return;
            }

            var isRetrospective = createdAt.HasValue
                ? FeedingPatternAnalyzer.IsRetrospectiveEntry(createdAt.Value, prediction.AnchorAt)
                : (bool?)null;

            var outcome = new PredictionOutcome(
                Guid.NewGuid(),
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
                prediction.Reason.Phase,
                IsRetrospective: isRetrospective);

            await repository.SaveAsync(outcome, cancellationToken);
            await ExpireOverLimitAsync(babyId, prediction.TypeKey, cancellationToken);
            await ApplyRetentionAsync(babyId, cancellationToken);
        }
        catch (Exception ex)
        {
            // Fire-and-forget: never let outcome recording break the prediction response.
            logger.LogError(ex, "Failed to record prediction outcome for baby {BabyId} type {TypeKey}", babyId, prediction.TypeKey.Value);
        }
    }

    /// <summary>
    /// Records manual user feedback on whether a prediction was accurate. The id is <c>typeKey:instant</c>: an ISO 8601 instant
    /// (what the web sends) names the pending outcome whose expected next start it is (within <see cref="FeedbackMatchTolerance"/>);
    /// a number (the older form) is UTC ticks of the outcome's predicted-at instant.
    /// </summary>
    public async Task RecordFeedbackAsync(Guid babyId, string predictionId, bool accurate, CancellationToken cancellationToken = default)
    {
        if (!options.AccuracyTrackingEnabled)
        {
            return;
        }

        try
        {
            if (!TryParsePredictionId(predictionId, out var typeKey, out var instant, out var isTicks))
            {
                logger.LogWarning("Invalid predictionId format for feedback from baby {BabyId}", babyId);
                return;
            }

            var pending = await repository.GetPendingAsync(babyId, typeKey, cancellationToken);
            var match = isTicks
                ? pending.FirstOrDefault(p => p.PredictedAt == instant)
                : pending
                    .Where(p => (p.ExpectedNextStart - instant).Duration() <= FeedbackMatchTolerance)
                    .OrderBy(p => (p.ExpectedNextStart - instant).Duration())
                    .FirstOrDefault();
            if (match is null)
            {
                logger.LogDebug("No pending outcome found for feedback on baby {BabyId} type {TypeKey}", babyId, typeKey.Value);
                return;
            }

            // For manual feedback: if accurate, error = 0; if inaccurate, error = large sentinel
            var actualTime = accurate ? match.ExpectedNextStart : match.ExpectedNextStart.AddHours(24);
            var resolved = match.Resolve(actualTime);
            await repository.SaveAsync(resolved, cancellationToken);

            logger.LogDebug("Recorded manual feedback for baby {BabyId} type {TypeKey}: accurate={Accurate}", babyId, typeKey.Value, accurate);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to record feedback for baby {BabyId}", babyId);
        }
    }

    /// <summary>
    /// Resolves, with an event of the type starting at <paramref name="actualNextStart"/>, every outcome that event is the actual
    /// next start of: outcomes anchored before it that are pending or were resolved by a later event. Each outcome thus ends
    /// with the first event after its anchor by event time, whatever order the events were written in (an outbox flushing
    /// several entries), and each write is conditional, so concurrent resolutions converge on the same result.
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
            var candidates = await repository.GetResolvableByAsync(babyId, typeKey, actualNextStart, cancellationToken);
            var written = 0;
            foreach (var candidate in candidates.Where(c => c.IsResolvableBy(actualNextStart)))
            {
                if (await repository.TryResolveAsync(candidate.Resolve(actualNextStart), cancellationToken))
                {
                    written++;
                }
            }

            if (written > 0)
            {
                logger.LogDebug("Resolved {Count} prediction outcomes for baby {BabyId} type {TypeKey}", written, babyId, typeKey.Value);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to resolve prediction outcome for baby {BabyId} type {TypeKey}", babyId, typeKey.Value);
        }
    }

    /// <summary>
    /// Removes any resolved prediction outcome anchored at <paramref name="oldAnchorAt"/> so a retrospective
    /// correction of an event's start time does not leave a stale scored outcome behind.
    /// </summary>
    public async Task InvalidateStaleOutcomeAsync(
        Guid babyId, EventTypeKey typeKey, DateTimeOffset oldAnchorAt, CancellationToken cancellationToken = default)
    {
        if (!options.AccuracyTrackingEnabled)
        {
            return;
        }

        try
        {
            await repository.InvalidateByAnchorAsync(babyId, typeKey, oldAnchorAt, cancellationToken);

            logger.LogDebug(
                "Invalidated stale prediction outcomes for baby {BabyId} type {TypeKey} at anchor {AnchorAt}",
                babyId,
                typeKey.Value,
                oldAnchorAt);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to invalidate stale prediction outcomes for baby {BabyId} type {TypeKey}", babyId, typeKey.Value);
        }
    }

    /// <summary>
    /// Parses <c>typeKey:instant</c>: <paramref name="isTicks"/> for the older form (UTC ticks of the predicted-at instant),
    /// otherwise an ISO 8601 date and time (an offset or <c>Z</c>; without one it is read as UTC).
    /// </summary>
    internal static bool TryParsePredictionId(string? predictionId, out EventTypeKey typeKey, out DateTimeOffset instant, out bool isTicks)
    {
        typeKey = default;
        instant = default;
        isTicks = false;
        var parts = predictionId?.Split(':', 2);
        if (parts is not { Length: 2 } || parts[1].Length == 0)
        {
            return false;
        }

        try
        {
            typeKey = EventTypeKey.From(parts[0]);
        }
        catch (DomainValidationException)
        {
            return false;
        }

        var value = parts[1];
        if (value.All(char.IsAsciiDigit))
        {
            if (!long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
                || ticks > DateTimeOffset.MaxValue.UtcTicks)
            {
                return false;
            }

            instant = new DateTimeOffset(ticks, TimeSpan.Zero);
            isTicks = true;
            return true;
        }

        // An ISO 8601 date and time only: a bare time of day would otherwise parse as today.
        if (value.Length < 11 || value[4] != '-' || value[7] != '-' || (value[10] != 'T' && value[10] != 't'))
        {
            return false;
        }

        if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed))
        {
            return false;
        }

        instant = parsed;
        return true;
    }

    private async Task ExpireOverLimitAsync(Guid babyId, EventTypeKey typeKey, CancellationToken cancellationToken)
    {
        var pending = await repository.GetPendingAsync(babyId, typeKey, cancellationToken);
        if (pending.Count <= options.MaxPendingOutcomes)
        {
            return;
        }

        var excess = pending.Take(pending.Count - options.MaxPendingOutcomes).ToArray();
        foreach (var old in excess)
        {
            // Closed without a measurement: no longer pending, and never counted in an accuracy average.
            await repository.SaveAsync(old.Expire(), cancellationToken);
        }

        logger.LogDebug(
            "Expired {ExpiredCount} oldest pending prediction outcomes for baby {BabyId} type {TypeKey} (limit {Limit})",
            excess.Length,
            babyId,
            typeKey.Value,
            options.MaxPendingOutcomes);
    }

    /// <summary>
    /// Retention: deletes every outcome of the baby (all types, pending included, so a row that never resolves does not stay)
    /// anchored more than <see cref="PredictionOptions.OutcomeRetentionDays"/> ago. It runs only here, when a new outcome is
    /// recorded for the baby; there is no job, so a baby with no new outcome keeps hers until she is erased.
    /// </summary>
    private async Task ApplyRetentionAsync(Guid babyId, CancellationToken cancellationToken)
    {
        if (options.OutcomeRetentionDays <= 0)
        {
            return;
        }

        var cutoff = time.GetUtcNow() - TimeSpan.FromDays(options.OutcomeRetentionDays);
        var deleted = await repository.DeleteAnchoredBeforeAsync(babyId, cutoff, cancellationToken);
        if (deleted > 0)
        {
            logger.LogDebug(
                "Deleted {DeletedCount} prediction outcomes anchored more than {RetentionDays} days ago for baby {BabyId}",
                deleted,
                options.OutcomeRetentionDays,
                babyId);
        }
    }
}
