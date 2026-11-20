using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>The instant the next start is measured from.</summary>
/// <param name="FromEventInProgress">The last event is still running and <see cref="At"/> is its expected end.</param>
internal sealed record NextStartAnchor(DateTimeOffset At, bool FromEventInProgress);

/// <summary>How the gaps leading to the next start are measured for a kind of event type.</summary>
internal interface INextStartStrategy
{
    PredictionBasis Basis { get; }

    bool CanHandle(EventTypeKey typeKey, PredictionOptions options);

    /// <summary>The gaps between consecutive events, each attributed to the instant it began.</summary>
    IEnumerable<TimedSample> CollectGaps(IReadOnlyList<ObservedEvent> chronological);

    /// <summary>The instant the next gap starts from; <paramref name="typicalDurationOf"/> estimates a running event's length.</summary>
    NextStartAnchor FindAnchor(IReadOnlyList<ObservedEvent> chronological, DateTimeOffset now, Func<ObservedEvent, TimeSpan?> typicalDurationOf);
}

/// <summary>Sleep: the next nap starts one awake window after the last wake.</summary>
internal sealed class AwakeWindowStrategy : INextStartStrategy
{
    public PredictionBasis Basis => PredictionBasis.AwakeWindow;

    public bool CanHandle(EventTypeKey typeKey, PredictionOptions options) => typeKey == options.AwakeWindowTypeKey;

    public IEnumerable<TimedSample> CollectGaps(IReadOnlyList<ObservedEvent> chronological) =>
        chronological
            .Zip(chronological.Skip(1))
            // Skip pairs where the first event has zero duration (started_at == ended_at), which are
            // typically duplicate marker events created when the app records sleep start and end
            // separately. These produce zero-length gaps that get filtered by MinimumSampleLength
            // downstream, but also corrupt the gap sequence by breaking adjacency between valid events.
            .Where(pair => pair.First.EndedAt is not null && pair.First.EndedAt != pair.First.StartedAt)
            .Select(pair => new TimedSample(pair.Second.StartedAt - pair.First.EndedAt!.Value, pair.First.EndedAt.Value));

    /// <remarks>
    /// While the last sleep is running the wake time is estimated as its start plus the typical (effective) duration of
    /// sleeps of its kind (see <see cref="TypePredictor"/>) plus the pauses it already had, and never earlier than
    /// <paramref name="now"/> because the baby is still asleep. Zero-duration events (started_at == ended_at) are
    /// skipped when selecting the anchor to avoid using duplicate marker events that cannot produce valid gaps.
    /// </remarks>
    public NextStartAnchor FindAnchor(IReadOnlyList<ObservedEvent> chronological, DateTimeOffset now, Func<ObservedEvent, TimeSpan?> typicalDurationOf)
    {
        // Walk backwards to find the most recent event with actual duration, skipping zero-duration
        // marker/duplicate events that would produce invalid anchors.
        for (var i = chronological.Count - 1; i >= 0; i--)
        {
            var candidate = chronological[i];
            if (candidate.EndedAt is { } wokeAt && candidate.EndedAt != candidate.StartedAt)
            {
                return new NextStartAnchor(wokeAt, false);
            }

            // If this event is still running (no EndedAt), use it as anchor with estimated wake time.
            if (candidate.EndedAt is null)
            {
                var expectedWake = candidate.StartedAt + (typicalDurationOf(candidate) ?? TimeSpan.Zero) + candidate.Paused;
                return new NextStartAnchor(expectedWake > now ? expectedWake : now, true);
            }
        }

        // Fallback: all events are zero-duration markers; use current time as anchor.
        return new NextStartAnchor(now, false);
    }
}

/// <summary>Default: the next event starts one typical interval after the last start.</summary>
internal sealed class StartIntervalStrategy : INextStartStrategy
{
    public PredictionBasis Basis => PredictionBasis.StartInterval;

    public bool CanHandle(EventTypeKey typeKey, PredictionOptions options) => true;

    public IEnumerable<TimedSample> CollectGaps(IReadOnlyList<ObservedEvent> chronological) =>
        chronological
            .Zip(chronological.Skip(1))
            .Select(pair => new TimedSample(pair.Second.StartedAt - pair.First.StartedAt, pair.First.StartedAt));

    public NextStartAnchor FindAnchor(IReadOnlyList<ObservedEvent> chronological, DateTimeOffset now, Func<ObservedEvent, TimeSpan?> typicalDurationOf) =>
        new(chronological[^1].StartedAt, false);
}
