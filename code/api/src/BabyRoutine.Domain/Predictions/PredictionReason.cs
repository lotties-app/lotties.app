using System.Globalization;

namespace BabyRoutine.Domain.Predictions;

/// <summary>
/// The structured parts behind a prediction; <see cref="Text"/> renders them as an English sentence, for example
/// <c>Median every 3h 10m over the last 14 days (night, age 3-6m), 42 samples. Typical duration 25m (40 samples).</c>
/// </summary>
/// <param name="MedianGap">Median interval between starts, or median awake window for <see cref="PredictionBasis.AwakeWindow"/>.</param>
/// <param name="AgeBand">The age band the samples were limited to, or <c>null</c> when all ages were used.</param>
/// <param name="Phase">The day/night phase the samples were limited to, or <c>null</c> when the whole day was used.</param>
/// <param name="AssumesEventInProgressEnds">
/// The last event is still running, so the next start is measured from its expected end (never earlier than now).
/// </param>
public sealed record PredictionReason(
    PredictionBasis Basis,
    TimeSpan MedianGap,
    int SampleCount,
    TimeSpan LookBack,
    AgeBand? AgeBand,
    DayPhase? Phase,
    DurationEstimate? TypicalDuration,
    bool AssumesEventInProgressEnds)
{
    private const int MinutesPerHour = 60;

    public string Text => string.Concat(GapSentence(), DurationSentence(), InProgressSentence());

    /// <summary>Compact duration such as <c>3h 10m</c>, <c>45m</c> or <c>2h</c>, rounded to the minute.</summary>
    public static string DurationText(TimeSpan value)
    {
        var totalMinutes = (long)Math.Round(value.TotalMinutes, MidpointRounding.AwayFromZero);
        var hours = totalMinutes / MinutesPerHour;
        var minutes = totalMinutes % MinutesPerHour;
        return (hours, minutes) switch
        {
            (0, _) => Invariant($"{minutes}m"),
            (_, 0) => Invariant($"{hours}h"),
            _ => Invariant($"{hours}h {minutes}m"),
        };
    }

    /// <summary>Whole days such as <c>14 days</c>.</summary>
    public static string DaysText(TimeSpan value) => Invariant($"{(int)Math.Round(value.TotalDays, MidpointRounding.AwayFromZero)} days");

    private string GapSentence()
    {
        var measure = Basis == PredictionBasis.AwakeWindow
            ? $"Median awake window {DurationText(MedianGap)} after the last wake"
            : $"Median every {DurationText(MedianGap)}";
        return Invariant($"{measure} over the last {DaysText(LookBack)}{QualifierText()}, {SampleCount} samples.");
    }

    private string QualifierText()
    {
        var qualifiers = new[]
            {
                Phase is { } phase ? DayPhases.Label(phase) : null,
                AgeBand is { } band ? $"age {AgeBands.Label(band)}" : null,
            }
            .OfType<string>()
            .ToArray();
        return qualifiers.Length == 0 ? string.Empty : $" ({string.Join(", ", qualifiers)})";
    }

    private string DurationSentence() => TypicalDuration is { } duration
        ? Invariant($" Typical duration {DurationText(duration.Median)} ({duration.SampleCount} samples).")
        : string.Empty;

    private string InProgressSentence() => AssumesEventInProgressEnds
        ? " Measured from the expected end of the one in progress."
        : string.Empty;

    private static string Invariant(FormattableString value) => value.ToString(CultureInfo.InvariantCulture);
}
