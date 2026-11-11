using Lotties.Domain.EventTypes;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Rhythm;

/// <summary>
/// "Her rhythm" (docs/design/48-baby-rhythm.md): the baby's usual bed time and wake-up, night length and stretches, naps
/// and feeds per day, and descriptive associations between the day and the night, all from her own events over the last
/// <see cref="RhythmOptions.LookBackDays"/> local days (today excluded). Pure, deterministic and independent of input
/// order; nothing is stored, nothing is guessed (a metric below its minimum is <see cref="RhythmStatus.NotEnoughData"/>),
/// nothing is compared with another baby or a norm.
/// </summary>
public static class BabyRhythm
{
    /// <summary>The earliest instant whose events the rhythm reads (the local start of the day before the window).</summary>
    public static DateTimeOffset LoadSince(DateTimeOffset now, LocalClock clock, RhythmOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(clock);
        return RhythmWindow.For(now, clock, options ?? RhythmOptions.Default).LoadFrom;
    }

    /// <param name="events">The baby's events that are not soft deleted, of any type, in any order; events after now, before
    /// <see cref="LoadSince"/> and fussy spells answered "Not crying" are ignored.</param>
    /// <param name="clock">The family's local clock (an IANA zone applies daylight saving per instant).</param>
    public static RhythmMeasurement Measure(IEnumerable<ObservedEvent> events, DateTimeOffset now, LocalClock clock, RhythmOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(clock);
        var rules = options ?? RhythmOptions.Default;
        var window = RhythmWindow.For(now, clock, rules);
        var usable = events.Where(item => item.StartedAt <= now && item.StartedAt >= window.LoadFrom && !item.ConfirmedNotCrying).ToArray();
        var sleep = OfType(usable, rules.SleepTypeKey);
        var sessions = SleepSessions.Build(sleep, now, rules.MaximumNightLength).ToArray();
        var nights = RhythmNights.Build(sessions, sleep, now, window, rules);
        var feeds = OfType(usable, rules.FeedingTypeKey);
        return new RhythmMeasurement(
            window.FirstDay,
            window.LastDay,
            nights,
            RhythmStatistics.Clock(nights.Select(night => window.MinuteOfDay(night.BedTime)).ToArray(), rules.MinimumNights, rules.MaximumClockSpread),
            RhythmStatistics.Clock(nights.Select(night => window.MinuteOfDay(night.WakeUp)).ToArray(), rules.MinimumNights, rules.MaximumClockSpread),
            RhythmStatistics.Durations(nights.Select(night => night.Length).ToArray(), rules.MinimumNights),
            RhythmStatistics.Durations(nights.Select(night => night.LongestStretch).ToArray(), rules.MinimumNights),
            RhythmStatistics.Durations(nights.Select(night => night.FirstStretch).ToArray(), rules.MinimumNights),
            RhythmDays.Naps(sessions, nights, now, window, rules),
            RhythmDays.Feeds(feeds, window, rules),
            RhythmAssociations.Measure(nights, feeds, OfType(usable, rules.DiaperTypeKey), window, rules));
    }

    private static IReadOnlyList<ObservedEvent> OfType(IReadOnlyList<ObservedEvent> events, EventTypeKey typeKey) =>
        events.Where(item => item.TypeKey == typeKey).OrderBy(item => item.StartedAt).ThenBy(item => item.EndedAt ?? DateTimeOffset.MaxValue).ToArray();
}
