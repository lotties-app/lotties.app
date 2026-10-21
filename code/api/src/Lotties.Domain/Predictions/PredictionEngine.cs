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
    public static PredictionSet Predict(IEnumerable<ObservedEvent> events, PredictionContext context, PredictionOptions options)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(options);
        var byType = InWindow(events, context, options)
            .GroupBy(item => item.TypeKey)
            .OrderBy(group => group.Key.Value, StringComparer.Ordinal)
            .Select(group => new TypeEvents(group.Key, SessionsOf(group, context, options)))
            .ToArray();
        var outcomes = byType.Select(type => PredictType(type, context, options)).ToArray();
        return new PredictionSet(
            outcomes.Select(outcome => outcome.Prediction).OfType<Prediction>().ToArray(),
            outcomes.Select(outcome => outcome.InsufficientData).OfType<InsufficientPredictionData>().ToArray())
        {
            BedTime = BedTimePredictor.Predict(SleepSessionsOf(byType, options), context, options),
        };
    }

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
    private static TypePredictionOutcome PredictType(TypeEvents type, PredictionContext context, PredictionOptions options)
    {
        var chronological = type.Events
            .OrderBy(item => item.StartedAt)
            .ThenBy(item => item.EndedAt ?? DateTimeOffset.MaxValue)
            .ToArray();
        if (chronological.Length == 0)
        {
            return new TypePredictionOutcome(null, new InsufficientPredictionData(type.TypeKey, 0, options.MinimumSamples, options.LookBack));
        }

        var strategy = Strategies.First(candidate => candidate.CanHandle(type.TypeKey, options));
        return new TypePredictor(type.TypeKey, chronological, context, options, strategy).Predict();
    }

    /// <summary>The events (sessions, for sleep) of one type in the look-back window.</summary>
    private sealed record TypeEvents(EventTypeKey TypeKey, IReadOnlyList<ObservedEvent> Events);
}
