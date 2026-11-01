namespace Lotties.Domain.Predictions;

/// <summary>Inputs of a prediction run besides the events.</summary>
/// <param name="BirthDate">The baby's birth date, used for age bands.</param>
/// <param name="Now">
/// The instant predictions are made for. Its <see cref="DateTimeOffset.Offset"/> is the family's current UTC offset
/// and is used only to tell day from night; every other calculation works on UTC instants.
/// </param>
public sealed record PredictionContext(DateOnly BirthDate, DateTimeOffset Now)
{
    /// <summary>The family's local UTC offset (taken from <see cref="Now"/>).</summary>
    public TimeSpan LocalOffset => Now.Offset;

    /// <summary>Local calendar date of <paramref name="instant"/>.</summary>
    public DateOnly LocalDateOf(DateTimeOffset instant) => DateOnly.FromDateTime(instant.ToOffset(LocalOffset).DateTime);
}
