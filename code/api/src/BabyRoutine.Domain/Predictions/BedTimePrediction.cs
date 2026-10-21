using System.Globalization;
using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Predictions;

/// <summary>
/// The next night's start (bed time) of the sleep type <see cref="TypeKey"/>, predicted from recent bed-time clocks
/// (heuristic v1.1, <see cref="BedTimePredictor"/>). Kept apart from <see cref="Prediction"/> so that consumers of the
/// per-type list keep seeing one sleep prediction (the next sleep after the last wake).
/// </summary>
/// <param name="NextStart">Earliest, expected and latest bed time (UTC): q25, median and q75 of the clocks.</param>
/// <param name="ExpectedDuration">Typical night duration, from finished night sessions only, or <c>null</c>.</param>
/// <param name="SampleCount">Number of bed-time clocks behind <see cref="NextStart"/> (those later than now).</param>
public sealed record BedTimePrediction(
    EventTypeKey TypeKey,
    NextStartWindow NextStart,
    DurationEstimate? ExpectedDuration,
    PredictionConfidence Confidence,
    int SampleCount,
    BedTimeReason Reason)
{
    /// <summary>The sleep payload kind this prediction is about (<c>night</c>).</summary>
    public string Kind => SleepKinds.Night;
}

/// <summary>
/// The structured parts behind a <see cref="BedTimePrediction"/>; <see cref="Text"/> renders them as an English
/// sentence, for example
/// <c>Median bed time 20:10 over the last 14 days, 9 samples (of 12 recent bed times). Typical duration 10h 30m (7 samples).</c>
/// </summary>
/// <param name="MedianClock">Local clock time of the expected bed time.</param>
/// <param name="SampleCount">Recent bed times whose clock is later than now (the samples of the window).</param>
/// <param name="RecentBedTimeCount">Recent bed times considered (one per evening, at most <see cref="PredictionOptions.BedTimeSampleCount"/>).</param>
public sealed record BedTimeReason(
    TimeOnly MedianClock,
    int SampleCount,
    int RecentBedTimeCount,
    TimeSpan LookBack,
    DurationEstimate? TypicalNightDuration)
{
    public PredictionBasis Basis => PredictionBasis.BedTimeClock;

    public string Text => string.Concat(ClockSentence(), DurationSentence());

    private string ClockSentence() => Invariant(
        $"Median bed time {MedianClock:HH:mm} over the last {PredictionReason.DaysText(LookBack)}, {SampleCount} samples (of {RecentBedTimeCount} recent bed times).");

    private string DurationSentence() => TypicalNightDuration is { } duration
        ? Invariant($" Typical duration {PredictionReason.DurationText(duration.Median)} ({duration.SampleCount} samples).")
        : string.Empty;

    private static string Invariant(FormattableString value) => value.ToString(CultureInfo.InvariantCulture);
}
