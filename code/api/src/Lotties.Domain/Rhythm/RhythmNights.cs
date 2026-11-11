using System.Collections.Immutable;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Rhythm;

/// <summary>
/// The counted nights of a rhythm (docs/design/48-baby-rhythm.md section 2): the finished night sessions
/// (<see cref="SleepSessions"/>) of one evening merged, bed time = earliest start, wake-up = latest end; the sleep is
/// their union minus the logged night wakings, cut into stretches. Running nights, nights outside the window and nights
/// shorter or longer than the limits are left out.
/// </summary>
internal static class RhythmNights
{
    /// <param name="sessions">The sleep sessions built from the sleep events.</param>
    /// <param name="sleepEvents">The raw sleep events (for the night wakings).</param>
    public static IReadOnlyList<RhythmNight> Build(
        IReadOnlyList<ObservedEvent> sessions,
        IReadOnlyList<ObservedEvent> sleepEvents,
        DateTimeOffset now,
        RhythmWindow window,
        RhythmOptions rules)
    {
        var wakings = sleepEvents
            .Where(item => item.Kind == SleepKinds.NightWaking && item.EndedAt is { } end && end > item.StartedAt)
            .Select(item => new Span(item.StartedAt, item.EndedAt!.Value))
            .ToArray();
        return sessions
            .Where(session => SleepSessionKinds.Of(session) == SleepSessionKind.Night)
            .GroupBy(session => window.EveningOf(session.StartedAt))
            .Where(evening => window.Contains(evening.Key))
            .Select(evening => NightOrNull(evening.Key, evening.ToArray(), wakings, now, rules))
            .OfType<RhythmNight>()
            .OrderBy(night => night.Evening)
            .ToArray();
    }

    private static RhythmNight? NightOrNull(DateOnly evening, IReadOnlyList<ObservedEvent> sessions, IReadOnlyList<Span> wakings, DateTimeOffset now, RhythmOptions rules)
    {
        if (sessions.Any(session => session.EndedAt is not { } end || end > now))
        {
            return null;
        }

        var bedTime = sessions.Min(session => session.StartedAt);
        var wakeUp = sessions.Max(session => session.EndedAt!.Value);
        var length = wakeUp - bedTime;
        return length < rules.MinimumNightLength || length > rules.MaximumNightLength
            ? null
            : Night(evening, bedTime, wakeUp, Stretches(sessions, wakings, bedTime, wakeUp, rules));
    }

    private static RhythmNight Night(DateOnly evening, DateTimeOffset bedTime, DateTimeOffset wakeUp, IReadOnlyList<Span> stretches) =>
        new(
            evening,
            bedTime,
            wakeUp,
            stretches.Select(stretch => stretch.Length).DefaultIfEmpty(TimeSpan.Zero).Max(),
            stretches.FirstOrDefault(stretch => stretch.Start == bedTime)?.Length ?? TimeSpan.Zero);

    /// <summary>The union of the sessions minus the wakings that start inside the night, without pieces under the minimum, in order.</summary>
    private static IReadOnlyList<Span> Stretches(IReadOnlyList<ObservedEvent> sessions, IReadOnlyList<Span> wakings, DateTimeOffset bedTime, DateTimeOffset wakeUp, RhythmOptions rules)
    {
        var slept = sessions
            .Select(session => new Span(session.StartedAt, session.EndedAt!.Value))
            .OrderBy(span => span.Start)
            .ThenBy(span => span.End)
            .Aggregate(ImmutableList<Span>.Empty, Merge);
        return wakings
            .Where(waking => waking.Start >= bedTime && waking.Start < wakeUp)
            .OrderBy(waking => waking.Start)
            .Aggregate((IReadOnlyList<Span>)slept, (pieces, waking) => pieces.SelectMany(piece => piece.Minus(waking)).ToArray())
            .Where(piece => piece.Length >= rules.MinimumStretchLength)
            .ToArray();
    }

    private static ImmutableList<Span> Merge(ImmutableList<Span> merged, Span next) =>
        merged.Count > 0 && next.Start <= merged[^1].End
            ? merged.SetItem(merged.Count - 1, merged[^1] with { End = Later(merged[^1].End, next.End) })
            : merged.Add(next);

    private static DateTimeOffset Later(DateTimeOffset first, DateTimeOffset second) => first >= second ? first : second;

    /// <summary>A stretch of time from <see cref="Start"/> to <see cref="End"/>.</summary>
    private sealed record Span(DateTimeOffset Start, DateTimeOffset End)
    {
        public TimeSpan Length => End - Start;

        /// <summary>What is left of this span outside <paramref name="cut"/> (zero, one or two pieces).</summary>
        public IEnumerable<Span> Minus(Span cut) =>
            cut.End <= Start || cut.Start >= End
                ? [this]
                : new[] { new Span(Start, cut.Start), new Span(cut.End, End) }.Where(piece => piece.End > piece.Start);
    }
}
