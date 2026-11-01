namespace Lotties.Application.Predictions;

/// <summary>Computes a baby's predictions from its recent events.</summary>
public interface IPredictionService
{
    /// <summary>
    /// Predictions for <paramref name="babyId"/> as of <paramref name="now"/>, or <c>null</c> when the baby does not exist.
    /// The offset of <paramref name="now"/> is the family's local UTC offset; it decides day versus night. The recurring
    /// patterns read local times in <paramref name="timeZone"/> (an IANA id, daylight saving applied per event) when the
    /// host knows it, else with that fixed offset.
    /// </summary>
    Task<PredictionsResponse?> GetAsync(Guid babyId, DateTimeOffset now, string? timeZone = null, CancellationToken cancellationToken = default);
}
