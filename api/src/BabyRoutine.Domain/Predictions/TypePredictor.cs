using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Predictions;

/// <summary>Either a prediction or the reason there is none, for one event type.</summary>
internal sealed record TypePredictionOutcome(Prediction? Prediction, InsufficientPredictionData? InsufficientData);

/// <summary>Predicts one event type from its events, which are in the look-back window and in chronological order.</summary>
internal sealed class TypePredictor
{
    private const double MedianQuantile = 0.5;

    private readonly EventTypeKey _typeKey;
    private readonly IReadOnlyList<ObservedEvent> _events;
    private readonly PredictionContext _context;
    private readonly PredictionOptions _options;
    private readonly INextStartStrategy _strategy;
    private readonly SampleSelector _selector;

    public TypePredictor(
        EventTypeKey typeKey,
        IReadOnlyList<ObservedEvent> chronological,
        PredictionContext context,
        PredictionOptions options,
        INextStartStrategy strategy)
    {
        _typeKey = typeKey;
        _events = chronological;
        _context = context;
        _options = options;
        _strategy = strategy;
        _selector = new SampleSelector(context, options, options.DayNightTypeKeys.Contains(typeKey));
    }

    public TypePredictionOutcome Predict()
    {
        var anchor = _strategy.FindAnchor(_events, _context.Now, start => EstimateDuration(start)?.Median);
        var gaps = _selector.Select(_strategy.CollectGaps(_events), anchor.At);
        return gaps.Samples.Count < _options.MinimumSamples
            ? new TypePredictionOutcome(null, new InsufficientPredictionData(_typeKey, gaps.Samples.Count, _options.MinimumSamples, _options.LookBack))
            : new TypePredictionOutcome(BuildPrediction(anchor, gaps), null);
    }

    private Prediction BuildPrediction(NextStartAnchor anchor, SampleSelection gaps)
    {
        var median = Quantile(gaps.Samples, MedianQuantile);
        var window = new NextStartWindow(
            Utc(anchor.At + Quantile(gaps.Samples, _options.WindowLowerQuantile)),
            Utc(anchor.At + median),
            Utc(anchor.At + Quantile(gaps.Samples, _options.WindowUpperQuantile)));
        var duration = EstimateDuration(window.Expected);
        var count = gaps.Samples.Count;
        var reason = new PredictionReason(
            _strategy.Basis,
            median,
            count,
            _options.LookBack,
            gaps.AgeBand,
            gaps.Phase,
            duration,
            anchor.FromEventInProgress);
        return new Prediction(_typeKey, window, duration, ConfidenceFor(count), count, reason);
    }

    /// <summary>Median duration of finished events, measured for the phase of <paramref name="start"/>; running events are ignored.</summary>
    private DurationEstimate? EstimateDuration(DateTimeOffset start)
    {
        var durations = _events
            .Where(item => item.EndedAt is not null)
            .Select(item => new TimedSample(item.EndedAt!.Value - item.StartedAt, item.StartedAt));
        var selection = _selector.Select(durations, start);
        return selection.Samples.Count < _options.MinimumSamples
            ? null
            : new DurationEstimate(Quantile(selection.Samples, MedianQuantile), selection.Samples.Count);
    }

    private PredictionConfidence ConfidenceFor(int sampleCount) => sampleCount switch
    {
        _ when sampleCount >= _options.HighConfidenceSamples => PredictionConfidence.High,
        _ when sampleCount >= _options.MediumConfidenceSamples => PredictionConfidence.Medium,
        _ => PredictionConfidence.Low,
    };

    private TimeSpan Quantile(IReadOnlyList<TimedSample> samples, double quantile) =>
        RoundToMinute(WeightedStatistics.Quantile(samples, quantile, _context.Now, _options.RecencyHalfLife));

    private static TimeSpan RoundToMinute(TimeSpan value) =>
        TimeSpan.FromMinutes(Math.Round(value.TotalMinutes, MidpointRounding.AwayFromZero));

    private static DateTimeOffset Utc(DateTimeOffset value) => value.ToUniversalTime();
}
