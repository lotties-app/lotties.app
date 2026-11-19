using Lotties.Domain.AgeNorms;
using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>
/// Heuristic predictions (<see cref="Version"/>): pure, deterministic and independent of input order. For each event
/// type with events in the last <see cref="PredictionOptions.LookBack"/>:
/// <list type="bullet">
/// <item>sleep events are first turned into sleep sessions by their payload kind (<see cref="SleepSessions"/>);</item>
/// <item>gaps are start-to-start intervals, or awake windows (last wake to next start) for sleep;</item>
/// <item>gaps and durations are narrowed to the current age band and, for feeding and sleep, to the day/night phase,
/// each only when enough samples remain; too-short samples and outliers are dropped;</item>
/// <item>the expected next start is the anchor plus the recency-weighted median gap, bounded by weighted quantiles;
/// a running sleep's expected end comes from finished sessions of the same kind only (v1.1, naps for a nap, nights
/// for a night);</item>
/// <item>the expected duration is the weighted median of finished events (running events are ignored);</item>
/// <item>confidence comes from the number of gaps.</item>
/// </list>
/// Types without enough gaps are reported in <see cref="PredictionSet.InsufficientData"/>. The next bed time is
/// predicted apart, from recent bed-time clocks (v1.1, <see cref="BedTimePredictor"/>, <see cref="PredictionSet.BedTime"/>).
/// </summary>
public static class PredictionEngine
{
    /// <summary>Version of the prediction rules, returned with every result.</summary>
    public const string Version = "heuristic-1.1";

    private static readonly IReadOnlyList<INextStartStrategy> Strategies =
        [new AwakeWindowStrategy(), new StartIntervalStrategy()];

    /// <param name="events">Past events that are not soft deleted, in any order; events outside the look-back window or after now are ignored.</param>
    /// <param name="ageNorms">
    /// Optional published age norms for cold-start predictions. When provided and a type has fewer than
    /// <see cref="PredictionOptions.MinimumSamples"/> usable gaps, the engine seeds a Low-confidence prediction from
    /// the norm instead of reporting insufficient data. Pass <c>null</c> to keep the current behaviour. Ignored when
    /// <paramref name="priorProviders"/> is supplied.
    /// </param>
    /// <param name="priorProviders">
    /// Optional ordered list of prior providers. When supplied, the engine uses a composite of these providers instead
    /// of the direct <see cref="AgeNormSet"/> lookup, enabling community-prior blending. Pass <c>null</c> to fall back
    /// to <paramref name="ageNorms"/>.
    /// </param>
    public static PredictionSet Predict(
        IEnumerable<ObservedEvent> events,
        PredictionContext context,
        PredictionOptions options,
        AgeNormSet? ageNorms = null,
        IReadOnlyList<IPriorProvider>? priorProviders = null,
        IReadOnlyDictionary<EventTypeKey, double>? accuracyAdjustments = null)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(options);
        var byType = InWindow(events, context, options)
            .GroupBy(item => item.TypeKey)
            .OrderBy(group => group.Key.Value, StringComparer.Ordinal)
            .Select(group => new TypeEvents(group.Key, SessionsOf(group, context, options)))
            .ToArray();
        var ageDays = CompletedDays(context.BirthDate, context.LocalDateOf(context.Now));
        var resolver = BuildResolver(ageNorms, priorProviders);
        var outcomes = byType.Select(type =>
        {
            var adj = accuracyAdjustments is not null && accuracyAdjustments.TryGetValue(type.TypeKey, out var v) ? (double?)v : null;
            return PredictType(type, context, options, ResolveColdStart(type.TypeKey, ageDays, resolver), adj);
        }).ToList();

        // When there are no events at all but a resolver can provide a cold-start prior, seed predictions for configured types.
        if (byType.Length == 0 && resolver is not null && ageDays >= 0)
        {
            foreach (var typeKey in options.ColdStartTypeKeys)
            {
                var prior = ResolveColdStart(typeKey, ageDays, resolver);
                if (prior is not null)
                {
                    var strategy = Strategies.First(candidate => candidate.CanHandle(typeKey, options));
                    var outcome = new TypePredictor(typeKey, [], context, options, strategy, prior).Predict();
                    if (outcome.Prediction is not null)
                    {
                        outcomes.Add(new TypePredictionOutcome(outcome.Prediction, null));
                    }
                }
            }
        }

        var predictionSet = new PredictionSet(
            outcomes.Select(outcome => outcome.Prediction).OfType<Prediction>().ToArray(),
            outcomes.Select(outcome => outcome.InsufficientData).OfType<InsufficientPredictionData>().ToArray())
        {
            BedTime = BedTimePredictor.Predict(SleepSessionsOf(byType, options), context, options),
        };

        // P1: Feeding volume and duration predictions.
        var feedingEvents = byType.FirstOrDefault(type => type.TypeKey == BuiltInEventTypes.Feeding.Key)?.Events ?? [];
        if (feedingEvents.Count > 0)
        {
            predictionSet = predictionSet with
            {
                FeedingVolumes = FeedingVolumePredictor.Predict(feedingEvents, context, options),
                FeedingDuration = ComputeFeedingDuration(feedingEvents, context, options),
            };
        }

        // P2: Diaper pattern analysis.
        var diaperEvents = byType.FirstOrDefault(type => type.TypeKey == BuiltInEventTypes.Diaper.Key)?.Events ?? [];
        if (diaperEvents.Count > 0)
        {
            predictionSet = predictionSet with
            {
                DiaperPatterns = DiaperPatternAnalyzer.Analyze(diaperEvents, context.Now, options.LookBack),
            };
        }

        // P3: Cry-cause classification for the latest fussy/crying event.
        if (options.CryCauseClassificationEnabled)
        {
            var allEventsInWindow = InWindow(events, context, options).ToArray();
            var latestCry = allEventsInWindow
                .Where(e => e.TypeKey == BuiltInEventTypes.Fussy.Key && !e.ConfirmedNotCrying)
                .OrderByDescending(e => e.StartedAt)
                .FirstOrDefault();

            if (latestCry is not null)
            {
                var assessment = CryCauseClassifier.Classify(allEventsInWindow, latestCry, context, options, predictionSet: predictionSet);
                if (assessment is not null)
                {
                    predictionSet = predictionSet with { CryCause = assessment };
                }
            }
        }

        return predictionSet;
    }

    private static FeedingDurationPrediction? ComputeFeedingDuration(IReadOnlyList<ObservedEvent> feedingEvents, PredictionContext context, PredictionOptions options)
    {
        // Use median volume from the volume predictor as the target, or fall back to a default of 120ml.
        var volumes = FeedingVolumePredictor.Predict(feedingEvents, context, options);
        var targetVolume = volumes is { Count: > 0 } ? volumes[0].MedianVolumeMl : 120.0;
        return FeedingDurationPredictor.Predict(feedingEvents, targetVolume, context, options);
    }

    private static IPriorProvider? BuildResolver(AgeNormSet? ageNorms, IReadOnlyList<IPriorProvider>? priorProviders)
    {
        if (priorProviders is not null && priorProviders.Count > 0)
        {
            return new CompositePriorProvider(priorProviders);
        }

        return ageNorms is null ? null : new AgeNormPriorProvider(ageNorms);
    }

    private static ColdStartPrior? ResolveColdStart(EventTypeKey typeKey, int ageDays, IPriorProvider? resolver) =>
        resolver?.GetPrior(typeKey, ageDays);

    private static int CompletedDays(DateOnly birthDate, DateOnly date) =>
        date < birthDate ? -1 : (int)(date.ToDateTime(TimeOnly.MinValue) - birthDate.ToDateTime(TimeOnly.MinValue)).TotalDays;

    private static IEnumerable<ObservedEvent> InWindow(IEnumerable<ObservedEvent> events, PredictionContext context, PredictionOptions options)
    {
        var windowStart = context.Now - options.LookBack;
        return events.Where(item => item.StartedAt >= windowStart && item.StartedAt <= context.Now);
    }

    /// <summary>Events of the awake-window type become sleep sessions (<see cref="SleepSessions"/>); other types are kept as they are.</summary>
    private static IReadOnlyList<ObservedEvent> SessionsOf(IGrouping<EventTypeKey, ObservedEvent> group, PredictionContext context, PredictionOptions options) =>
        group.Key == options.AwakeWindowTypeKey
            ? SleepSessions.Build(group.ToArray(), context.Now, options.MaxNightSessionLength).ToArray()
            : group.ToArray();

    private static IReadOnlyList<ObservedEvent> SleepSessionsOf(IReadOnlyList<TypeEvents> byType, PredictionOptions options) =>
        byType.FirstOrDefault(type => type.TypeKey == options.AwakeWindowTypeKey)?.Events ?? [];

    /// <remarks>A type whose events yield no sessions (e.g. only night wakings) is reported with zero samples.</remarks>
    private static TypePredictionOutcome PredictType(TypeEvents type, PredictionContext context, PredictionOptions options, ColdStartPrior? coldStartPrior, double? accuracyAdjustment = null)
    {
        var chronological = type.Events
            .OrderBy(item => item.StartedAt)
            .ThenBy(item => item.EndedAt ?? DateTimeOffset.MaxValue)
            .ToArray();
        if (chronological.Length == 0)
        {
            return coldStartPrior is not null
                ? new TypePredictionOutcome(new TypePredictor(type.TypeKey, [], context, options, Strategies.First(candidate => candidate.CanHandle(type.TypeKey, options)), coldStartPrior, accuracyAdjustment).Predict().Prediction, null)
                : new TypePredictionOutcome(null, new InsufficientPredictionData(type.TypeKey, 0, options.MinimumSamples, options.LookBack));
        }

        var strategy = Strategies.First(candidate => candidate.CanHandle(type.TypeKey, options));
        return new TypePredictor(type.TypeKey, chronological, context, options, strategy, coldStartPrior, accuracyAdjustment).Predict();
    }

    /// <summary>The events (sessions, for sleep) of one type in the look-back window.</summary>
    private sealed record TypeEvents(EventTypeKey TypeKey, IReadOnlyList<ObservedEvent> Events);
}
