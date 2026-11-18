using Lotties.Domain.EventTypes;

namespace Lotties.Application.Predictions;

/// <summary>Records and resolves prediction outcomes for accuracy tracking and user feedback.</summary>
public interface IPredictionOutcomeResolutionService
{
    /// <summary>Records user feedback on whether a prediction was accurate.</summary>
    Task RecordFeedbackAsync(Guid babyId, string predictionId, bool accurate, CancellationToken cancellationToken = default);

    /// <summary>
    /// Automatically resolves the oldest pending prediction outcome for a baby and event type when a new event of that
    /// type arrives. Computes the error between predicted and actual start times. Called from the event ingestion path
    /// so predictions learn from real logged events without manual feedback.
    /// </summary>
    Task ResolvePendingAsync(Guid babyId, EventTypeKey typeKey, DateTimeOffset actualNextStart, CancellationToken cancellationToken = default);
}