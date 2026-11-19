using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Application.Predictions;

/// <summary>Records and resolves prediction outcomes for accuracy tracking and user feedback.</summary>
public interface IPredictionOutcomeResolutionService
{
    /// <summary>
    /// Records a prediction as a pending outcome for later resolution against the actual next event.
    /// When <paramref name="createdAt"/> is provided, the outcome is flagged as retrospective if the event
    /// was logged significantly after its own start time (see <see cref="FeedingPatternAnalyzer.IsRetrospectiveEntry"/>).
    /// </summary>
    Task RecordPredictionAsync(Prediction prediction, Guid babyId, string engineVersion, DateTimeOffset? createdAt = null, CancellationToken cancellationToken = default);

    /// <summary>Records user feedback on whether a prediction was accurate.</summary>
    Task RecordFeedbackAsync(Guid babyId, string predictionId, bool accurate, CancellationToken cancellationToken = default);

    /// <summary>
    /// Automatically resolves the oldest pending prediction outcome for a baby and event type when a new event of that
    /// type arrives. Computes the error between predicted and actual start times. Called from the event ingestion path
    /// so predictions learn from real logged events without manual feedback.
    /// </summary>
    Task ResolvePendingAsync(Guid babyId, EventTypeKey typeKey, DateTimeOffset actualNextStart, CancellationToken cancellationToken = default);

    /// <summary>
    /// Removes any resolved prediction outcome anchored at <paramref name="oldAnchorAt"/> for the given baby and event
    /// type. Called before <see cref="ResolvePendingAsync"/> when a parent retrospectively corrects an event's start
    /// time so the stale outcome (scored against the wrong timestamp) does not pollute accuracy metrics.
    /// </summary>
    Task InvalidateStaleOutcomeAsync(Guid babyId, EventTypeKey typeKey, DateTimeOffset oldAnchorAt, CancellationToken cancellationToken = default);
}