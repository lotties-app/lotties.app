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
    private readonly ColdStartPrior? _coldStartPrior;
    private readonly double? _accuracyAdjustment;
    private readonly bool _classifiesSleepKinds;

    public TypePredictor(
        EventTypeKey typeKey,
        IReadOnlyList<ObservedEvent> chronological,
        PredictionContext context,
        PredictionOptions options,
        INextStartStrategy strategy,
        ColdStartPrior? coldStartPrior = null,
        double? accuracyAdjustment = null)
    {
        _typeKey = typeKey;
        _events = chronological;
        _context = context;
        _options = options;
        _strategy = strategy;
        _selector = new SampleSelector(context, options, options.DayNightTypeKeys.Contains(typeKey));
        _durations = new DurationEstimator(chronological, _selector, context, options);
        _coldStartPrior = coldStartPrior;
        _accuracyAdjustment = accuracyAdjustment;
        _classifiesSleepKinds = typeKey == options.AwakeWindowTypeKey;
    }

    public TypePredictionOutcome Predict()
    {
        // Cold start with no events at all: anchor is now, no gaps to collect.
        if (_events.Count == 0 && _coldStartPrior is not null)
        {
            return new TypePredictionOutcome(BuildColdStartPrediction(new NextStartAnchor(_context.Now, false), _coldStartPrior), null);
        }

        var effectiveLookBack = AdaptiveLookBack.Resolve(_events, _context, _options);
        var windowStart = _context.Now - effectiveLookBack;
        var inWindow = _events.Where(item => item.StartedAt >= windowStart && item.StartedAt <= _context.Now).ToArray();

        if (inWindow.Length == 0 && _coldStartPrior is not null)
        {
            return new TypePredictionOutcome(BuildColdStartPrediction(new NextStartAnchor(_context.Now, false), _coldStartPrior), null);
        }

        if (inWindow.Length == 0)
        {
            return new TypePredictionOutcome(null, new InsufficientPredictionData(_typeKey, 0, _options.MinimumSamples, effectiveLookBack));
        }

        var anchor = _strategy.FindAnchor(inWindow, _context.Now, TypicalDurationOfRunning);

        // When predicting awake windows (sleep/naps) and the current time falls in the night phase,
        // use a daytime reference for phase filtering so we select nap-relevant samples rather than
        // night-sleep samples. Without this, checking the app after NightStartsAt (e.g. 19:00) would
        // filter to night-only samples and return insufficient data despite abundant daytime naps.
        var sampleReference = anchor.At;
        if (_classifiesSleepKinds && _options.DayNightTypeKeys.Contains(_typeKey))
        {
            var currentPhase = DayPhases.Of(_context.Now, _context.LocalOffset, _options);
            if (currentPhase == DayPhase.Night)
            {
                // Use noon today as a representative daytime reference for nap prediction
                var todayNoon = new DateTimeOffset(_context.LocalDateOf(_context.Now), new TimeOnly(12, 0), _context.LocalOffset);
                sampleReference = todayNoon;
            }
        }

        var gaps = _selector.Select(_strategy.CollectGaps(inWindow), sampleReference);
        if (gaps.Samples.Count >= _options.MinimumSamples)
        {
            return new TypePredictionOutcome(BuildPrediction(anchor, gaps, effectiveLookBack), null);
        }

        if (_coldStartPrior is not null)
        {
            return new TypePredictionOutcome(BuildColdStartPrediction(anchor, _coldStartPrior), null);
        }

        return new TypePredictionOutcome(null, new InsufficientPredictionData(_typeKey, gaps.Samples.Count, _options.MinimumSamples, effectiveLookBack));
    }

    private Prediction BuildPrediction(NextStartAnchor anchor, SampleSelection gaps, TimeSpan effectiveLookBack)
    {
        var median = Quantile(gaps.Samples, MedianQuantile);
        var origin = PriorOrigin.PublishedNorm;

        // Blend with prior when enabled and a community/norm prior is available.
        if (_options.BlendingEnabled && _coldStartPrior is not null && gaps.Samples.Count > 0)
        {
            var blended = WeightedSampleSet.BlendQuantile(
                gaps.Samples,
                MedianQuantile,
                _context.Now,
                _options.RecencyHalfLife,
                _coldStartPrior.MedianGap,
                _coldStartPrior.PriorLogSd ?? 0.5,
                _options,
                accuracyAdjustment: _accuracyAdjustment);

            median = WeightedStatistics.RoundToMinute(blended.BlendedMedian);
            origin = blended.Source switch
            {
                BlendSource.PriorOnly => _coldStartPrior.Origin,
                BlendSource.Blended => _coldStartPrior.Origin,
                _ => PriorOrigin.PublishedNorm,
            };
        }

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
            effectiveLookBack,
            gaps.AgeBand,
            gaps.Phase,
            duration,
            anchor.FromEventInProgress);
        var interval = _options.UsePredictionIntervals && gaps.Samples.Count > 0
            ? PredictionInterval.FromPercentiles(
                gaps.Samples.Select(s => s.Length).ToArray(),
                _options.WindowLowerQuantile,
                _options.WindowUpperQuantile)
            : null;
        return new Prediction(_typeKey, window, duration, PredictionConfidences.For(count, _options), count, reason, origin, Utc(anchor.At), interval);
    }

    /// <summary>
    /// A prediction seeded from a published age norm when the baby has too few logged events. Uses Low confidence and
    /// reports zero samples so consumers can distinguish it from a data-driven prediction.
    /// </summary>
    private Prediction BuildColdStartPrediction(NextStartAnchor anchor, ColdStartPrior prior)
    {
        var window = new NextStartWindow(
            Utc(anchor.At + prior.MedianGap),
            Utc(anchor.At + prior.MedianGap),
            Utc(anchor.At + prior.MedianGap));
        var reason = new PredictionReason(
            _strategy.Basis,
            prior.MedianGap,
            0,
            TimeSpan.Zero,
            null,
            null,
            prior.TypicalDuration is { } duration ? new DurationEstimate(duration, 0) : null,
            anchor.FromEventInProgress);
        return new Prediction(_typeKey, window, prior.TypicalDuration is { } dur ? new DurationEstimate(dur, 0) : null, PredictionConfidence.Low, 0, reason, prior.Origin, Utc(anchor.At));
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
