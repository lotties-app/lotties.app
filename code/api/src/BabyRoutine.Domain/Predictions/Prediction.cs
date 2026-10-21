using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Predictions;

/// <summary>How sure a prediction is, from the number of samples behind it.</summary>
public enum PredictionConfidence
{
    Low,
    Medium,
    High,
}

/// <summary>Confidence rules shared by every prediction.</summary>
internal static class PredictionConfidences
{
    public static PredictionConfidence For(int sampleCount, PredictionOptions options) => sampleCount switch
    {
        _ when sampleCount >= options.HighConfidenceSamples => PredictionConfidence.High,
        _ when sampleCount >= options.MediumConfidenceSamples => PredictionConfidence.Medium,
        _ => PredictionConfidence.Low,
    };
}

/// <summary>What the next start was measured from.</summary>
public enum PredictionBasis
{
    /// <summary>Start of the last event plus the typical interval between starts.</summary>
    StartInterval,

    /// <summary>End of the last event (wake time) plus the typical gap until the next start (awake window).</summary>
    AwakeWindow,

    /// <summary>Quantiles of the recent bed-time clocks still later than now (heuristic v1.1, <see cref="BedTimePrediction"/>).</summary>
    BedTimeClock,
}

/// <summary>When the next event is expected (UTC): <see cref="Expected"/> is the median, the bounds are quantiles.</summary>
public sealed record NextStartWindow(DateTimeOffset Earliest, DateTimeOffset Expected, DateTimeOffset Latest);

/// <summary>Typical (median) duration and how many finished events it comes from.</summary>
public sealed record DurationEstimate(TimeSpan Median, int SampleCount);

/// <summary>A prediction for one event type.</summary>
/// <param name="SampleCount">Number of intervals behind <see cref="NextStart"/>.</param>
/// <param name="AnchorAt">
/// The instant (UTC) the next start is measured from: the last start (<see cref="PredictionBasis.StartInterval"/>), the
/// end of the last sleep session (<see cref="PredictionBasis.AwakeWindow"/>), or the expected end of the one in progress.
/// Domain only, not on the wire (push reminders key one nap window per anchor).
/// </param>
public sealed record Prediction(
    EventTypeKey TypeKey,
    NextStartWindow NextStart,
    DurationEstimate? ExpectedDuration,
    PredictionConfidence Confidence,
    int SampleCount,
    PredictionReason Reason,
    DateTimeOffset AnchorAt);

/// <summary>An event type that has events but too few usable intervals to predict.</summary>
public sealed record InsufficientPredictionData(EventTypeKey TypeKey, int SampleCount, int RequiredSamples, TimeSpan LookBack)
{
    public string Reason =>
        $"Not enough data: {SampleCount} of {RequiredSamples} intervals needed over the last {PredictionReason.DaysText(LookBack)}.";
}

/// <summary>Result of a prediction run, ordered by type key.</summary>
public sealed record PredictionSet(IReadOnlyList<Prediction> Predictions, IReadOnlyList<InsufficientPredictionData> InsufficientData)
{
    public static PredictionSet Empty { get; } = new(Array.Empty<Prediction>(), Array.Empty<InsufficientPredictionData>());

    /// <summary>The next night's start (bed time), or <c>null</c> when there is none to predict (see <see cref="BedTimePrediction"/>).</summary>
    public BedTimePrediction? BedTime { get; init; }

    /// <summary>The rules that produced this set (<see cref="PredictionEngine.Version"/>).</summary>
    public string EngineVersion => PredictionEngine.Version;
}
