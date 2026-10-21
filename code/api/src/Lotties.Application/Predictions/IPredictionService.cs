namespace Lotties.Application.Predictions;

/// <summary>Computes a baby's predictions from its recent events.</summary>
public interface IPredictionService
{
    /// <summary>
    /// Predictions for <paramref name="babyId"/> as of <paramref name="now"/>, or <c>null</c> when the baby does not exist.
    /// The offset of <paramref name="now"/> is the family's local UTC offset; it only decides day versus night.
    /// </summary>
    Task<PredictionsResponse?> GetAsync(Guid babyId, DateTimeOffset now, CancellationToken cancellationToken = default);
}
