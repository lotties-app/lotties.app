using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Predictions;

/// <summary>How sure a prediction is, from the number of samples behind it.</summary>
public enum PredictionConfidence
{
    Low,
    Medium,
    High,
}

/// <summary>What the next start was measured from.</summary>
public enum PredictionBasis
{
    /// <summary>Start of the last event plus the typical interval between starts.</summary>
    StartInterval,

    /// <summary>End of the last event (wake time) plus the typical gap until the next start (awake window).</summary>
    AwakeWindow,
}

/// <summary>When the next event is expected (UTC): <see cref="Expected"/> is the median, the bounds are quantiles.</summary>
public sealed record NextStartWindow(DateTimeOffset Earliest, DateTimeOffset Expected, DateTimeOffset Latest);

/// <summary>Typical (median) duration and how many finished events it comes from.</summary>
public sealed record DurationEstimate(TimeSpan Median, int SampleCount);

/// <summary>A prediction for one event type.</summary>
/// <param name="SampleCount">Number of intervals behind <see cref="NextStart"/>.</param>
public sealed record Prediction(
    EventTypeKey TypeKey,
    NextStartWindow NextStart,
    DurationEstimate? ExpectedDuration,
    PredictionConfidence Confidence,
    int SampleCount,
    PredictionReason Reason);

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
}
