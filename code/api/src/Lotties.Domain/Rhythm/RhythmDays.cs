using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Rhythm;

/// <summary>The daytime part of a rhythm (docs/design/48-baby-rhythm.md section 3): naps per bracketed day, the usual nap starts, feeds per day and the gap between feeds.</summary>
internal static class RhythmDays
{
    /// <summary>
    /// Naps per day over the days between two counted nights (wake-up of evening D-1 to bed time of evening D), counting
    /// the finished nap sessions that start inside them; the usual starts from the detector, peeled one window at a time.
    /// </summary>
    public static NapRhythm Naps(IReadOnlyList<ObservedEvent> sessions, IReadOnlyList<RhythmNight> nights, DateTimeOffset now, RhythmWindow window, RhythmOptions rules)
    {
        var naps = sessions.Where(session => SleepSessionKinds.Of(session) == SleepSessionKind.Nap).ToArray();
        var finished = naps.Where(nap => nap.EndedAt is { } end && end <= now).ToArray();
        var perDay = BracketedDays(nights).Select(day => finished.Count(nap => nap.StartedAt >= day.From && nap.StartedAt < day.To)).ToArray();
        var starts = naps.Select(nap => window.Clock.ToLocal(nap.StartedAt)).ToArray();
        return new NapRhythm(
            RhythmStatistics.Counts(perDay, rules.MinimumDays, perDay.Any(count => count > 0)),
            UsualStarts(starts, window.Today, rules, rules.MaximumNapPatterns).OrderBy(pattern => pattern.Typical).ToArray());
    }

    /// <summary>Feeds per local day of the window with at least one feed, and the start-to-start gaps up to the maximum.</summary>
    public static FeedRhythm Feeds(IReadOnlyList<ObservedEvent> feeds, RhythmWindow window, RhythmOptions rules)
    {
        var inWindow = feeds.Where(feed => window.Contains(window.DateOf(feed.StartedAt))).OrderBy(feed => feed.StartedAt).ToArray();
        var perDay = inWindow.GroupBy(feed => window.DateOf(feed.StartedAt)).Select(day => day.Count()).ToArray();
        var gaps = inWindow
            .Zip(inWindow.Skip(1), (previous, next) => next.StartedAt - previous.StartedAt)
            .Where(gap => gap > TimeSpan.Zero && gap <= rules.MaximumFeedGap)
            .ToArray();
        return new FeedRhythm(RhythmStatistics.Counts(perDay, rules.MinimumDays), RhythmStatistics.Durations(gaps, rules.MinimumFeedGaps));
    }

    private static IEnumerable<DaySpan> BracketedDays(IReadOnlyList<RhythmNight> nights) =>
        nights
            .Zip(nights.Skip(1))
            .Where(pair => pair.Second.Evening == pair.First.Evening.AddDays(1) && pair.First.WakeUp < pair.Second.BedTime)
            .Select(pair => new DaySpan(pair.First.WakeUp, pair.Second.BedTime));

    /// <summary>The detector's pattern, then the patterns of the nap starts left outside its window, at most <paramref name="remaining"/>.</summary>
    private static IEnumerable<TimeOfDayPattern> UsualStarts(IReadOnlyList<DateTime> starts, DateOnly today, RhythmOptions rules, int remaining)
    {
        if (remaining <= 0 || RecurringTimeOfDayPattern.Detect(starts, today, rules.NapPatterns) is not { } pattern)
        {
            return [];
        }

        var outside = starts.Where(start => !IsInside(start, pattern)).ToArray();
        return UsualStarts(outside, today, rules, remaining - 1).Prepend(pattern);
    }

    private static bool IsInside(DateTime start, TimeOfDayPattern pattern)
    {
        var typical = (pattern.Typical.Hour * 60) + pattern.Typical.Minute;
        return CircularSummary.Distance((start.Hour * 60) + start.Minute, typical) <= pattern.Width.TotalMinutes / 2;
    }

    private sealed record DaySpan(DateTimeOffset From, DateTimeOffset To);
}
