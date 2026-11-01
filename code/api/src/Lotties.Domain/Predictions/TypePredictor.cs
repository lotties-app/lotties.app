using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

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
    private readonly DurationEstimator _durations;
    private readonly bool _classifiesSleepKinds;

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
        _durations = new DurationEstimator(chronological, _selector, context, options);
        _classifiesSleepKinds = typeKey == options.AwakeWindowTypeKey;
    }

    public TypePredictionOutcome Predict()
    {
        var anchor = _strategy.FindAnchor(_events, _context.Now, TypicalDurationOfRunning);
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
        var duration = _durations.Estimate(window.Expected, kind: null);
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
        return new Prediction(_typeKey, window, duration, PredictionConfidences.For(count, _options), count, reason, Utc(anchor.At));
    }

    /// <summary>
    /// Typical length of the running event. Heuristic v1.1: a running sleep is measured only against finished
    /// sessions of the same kind (naps for a nap, nights for a night), so an evening nap is not expected to last a
    /// night and an early bed time is not expected to last a nap.
    /// </summary>
    private TimeSpan? TypicalDurationOfRunning(ObservedEvent running) =>
        _durations.Estimate(running.StartedAt, _classifiesSleepKinds ? SleepSessionKinds.Of(running) : null)?.Median;

    private TimeSpan Quantile(IReadOnlyList<TimedSample> samples, double quantile) =>
        WeightedStatistics.RoundToMinute(WeightedStatistics.Quantile(samples, quantile, _context.Now, _options.RecencyHalfLife));

    private static DateTimeOffset Utc(DateTimeOffset value) => value.ToUniversalTime();
}
