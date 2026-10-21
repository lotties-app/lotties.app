namespace Lotties.Domain.Predictions;

/// <summary>What predictions need about a baby: the birth date and the recent events that are not soft deleted.</summary>
public sealed record PredictionHistory(DateOnly BirthDate, IReadOnlyList<ObservedEvent> Events);

/// <summary>Read access to the history predictions are computed from.</summary>
public interface IPredictionHistoryRepository
{
    /// <summary>
    /// The birth date of <paramref name="babyId"/> and its non-deleted events started at or after
    /// <paramref name="since"/>, or <c>null</c> when the baby does not exist.
    /// </summary>
    Task<PredictionHistory?> LoadAsync(Guid babyId, DateTimeOffset since, CancellationToken cancellationToken = default);
}
