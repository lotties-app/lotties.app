using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Predictions;

/// <summary>
/// Heuristic v1 predictions: pure, deterministic and independent of input order. For each event type with events
/// in the last <see cref="PredictionOptions.LookBack"/>:
/// <list type="bullet">
/// <item>gaps are start-to-start intervals, or awake windows (last wake to next start) for sleep;</item>
/// <item>gaps and durations are narrowed to the current age band and, for feeding and sleep, to the day/night phase,
/// each only when enough samples remain; too-short samples and outliers are dropped;</item>
/// <item>the expected next start is the anchor plus the recency-weighted median gap, bounded by weighted quantiles;</item>
/// <item>the expected duration is the weighted median of finished events (running events are ignored);</item>
/// <item>confidence comes from the number of gaps.</item>
/// </list>
/// Types without enough gaps are reported in <see cref="PredictionSet.InsufficientData"/>.
/// </summary>
public static class PredictionEngine
{
    private static readonly IReadOnlyList<INextStartStrategy> Strategies =
        [new AwakeWindowStrategy(), new StartIntervalStrategy()];

    /// <param name="events">Past events that are not soft deleted, in any order; events outside the look-back window or after now are ignored.</param>
    public static PredictionSet Predict(IEnumerable<ObservedEvent> events, PredictionContext context, PredictionOptions options)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(options);
        var outcomes = InWindow(events, context, options)
            .GroupBy(item => item.TypeKey)
            .OrderBy(group => group.Key.Value, StringComparer.Ordinal)
            .Select(group => PredictType(group, context, options))
            .ToArray();
        return new PredictionSet(
            outcomes.Select(outcome => outcome.Prediction).OfType<Prediction>().ToArray(),
            outcomes.Select(outcome => outcome.InsufficientData).OfType<InsufficientPredictionData>().ToArray());
    }

    private static IEnumerable<ObservedEvent> InWindow(IEnumerable<ObservedEvent> events, PredictionContext context, PredictionOptions options)
    {
        var windowStart = context.Now - options.LookBack;
        return events.Where(item => item.StartedAt >= windowStart && item.StartedAt <= context.Now);
    }

    private static TypePredictionOutcome PredictType(IGrouping<EventTypeKey, ObservedEvent> group, PredictionContext context, PredictionOptions options)
    {
        var chronological = group
            .OrderBy(item => item.StartedAt)
            .ThenBy(item => item.EndedAt ?? DateTimeOffset.MaxValue)
            .ToArray();
        var strategy = Strategies.First(candidate => candidate.CanHandle(group.Key, options));
        return new TypePredictor(group.Key, chronological, context, options, strategy).Predict();
    }
}
