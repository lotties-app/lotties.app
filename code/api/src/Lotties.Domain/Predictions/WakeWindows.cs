using Lotties.Domain.Patterns;

namespace Lotties.Domain.Predictions;

/// <summary>
/// The overtired heads-up ("hora da bruxa", docs/design/11-patterns.md section 6): how long this baby usually stays
/// awake comfortably, from the log, and how long she has been awake now. Pure and deterministic; input order does not
/// matter. Rules, with <see cref="WakeWindowOptions.Default"/>:
/// <list type="number">
/// <item>Sleep events become sleep sessions as for the nap window (<see cref="SleepSessions"/>: night wakings are not
/// sleep, <c>bed_time</c> to <c>woke_up</c> is a night, a timer right after <c>fell_asleep</c> inside a night is that night).</item>
/// <item>An awake stretch runs from the latest end of the sessions so far to the start of the next session; it is
/// finished when that next session started.</item>
/// <item>Only stretches that started in the last 14 days, between 05:00 (inclusive) and 18:00 (exclusive) local time,
/// count. Local times come from <see cref="LocalClock"/> (an IANA zone applies daylight saving per instant); lengths are
/// real elapsed time.</item>
/// <item>Stretches under 1 minute (overlapping logs) and over 3 times the plain median (a nap that was not logged) are
/// dropped. With fewer than 5 left there is no wake window: nothing is guessed.</item>
/// <item>The limit is the 75th percentile of the stretches (linear interpolation between the closest ranks), to the minute.</item>
/// <item>The current stretch starts at the latest sleep end (a finished session or a <c>woke_up</c> marker). There is
/// none while a sleep runs, after a newer lone <c>fell_asleep</c> marker (at most 16 hours old) or when a night waking
/// ended at or after that start (the baby is up in the night).</item>
/// </list>
/// </summary>
public static class WakeWindows
{
    /// <param name="events">Past events that are not soft deleted, of any type, in any order; events after now are ignored.</param>
    /// <param name="clock">The family's local clock (decides which stretches are daytime).</param>
    /// <returns>The wake window, or <c>null</c> with too few daytime stretches.</returns>
    public static WakeWindow? Measure(
        IEnumerable<ObservedEvent> events,
        DateTimeOffset now,
        LocalClock clock,
        WakeWindowOptions? options = null,
        PredictionOptions? predictionOptions = null)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(clock);
        var rules = options ?? WakeWindowOptions.Default;
        var sleep = predictionOptions ?? PredictionOptions.Default;
        var sleepEvents = events.Where(item => item.TypeKey == sleep.AwakeWindowTypeKey && item.StartedAt <= now).ToArray();
        var sessions = SleepSessions.Build(sleepEvents, now, sleep.MaxNightSessionLength).ToArray();
        var stretches = Usable(FinishedStretches(sessions).Where(stretch => IsRecentDaytime(stretch, now, clock, rules)).ToArray(), rules);
        return stretches.Count < rules.MinimumStretches
            ? null
            : new WakeWindow(LimitOf(stretches, rules), stretches, AwakeSince(sleepEvents, sessions, now, rules));
    }

    /// <summary>The stretches between consecutive sessions, measured from the latest end so far, oldest first.</summary>
    private static IEnumerable<AwakeStretch> FinishedStretches(IReadOnlyList<ObservedEvent> sessions)
    {
        var ordered = sessions.OrderBy(item => item.StartedAt).ThenBy(item => item.EndedAt ?? DateTimeOffset.MaxValue).ToArray();
        return ordered
            .Skip(1)
            .Select((next, index) => new { From = LatestEnd(ordered.Take(index + 1)), To = next.StartedAt })
            .Where(pair => pair.From < pair.To)
            .Select(pair => new AwakeStretch(pair.From, pair.To));
    }

    /// <summary>The latest end of <paramref name="sessions"/>; a running one never ends.</summary>
    private static DateTimeOffset LatestEnd(IEnumerable<ObservedEvent> sessions) => sessions.Max(session => session.EndedAt ?? DateTimeOffset.MaxValue);

    private static bool IsRecentDaytime(AwakeStretch stretch, DateTimeOffset now, LocalClock clock, WakeWindowOptions rules)
    {
        var startedAt = TimeOnly.FromDateTime(clock.ToLocal(stretch.Start));
        return stretch.Start >= now - rules.LookBack && startedAt >= rules.DayStartsAt && startedAt < rules.DayEndsAt;
    }

    /// <summary>Drops too-short stretches, then the ones longer than the outlier factor times the plain (lower) median.</summary>
    private static IReadOnlyList<AwakeStretch> Usable(IReadOnlyList<AwakeStretch> stretches, WakeWindowOptions rules)
    {
        var longEnough = stretches.Where(stretch => stretch.Length >= rules.MinimumStretchLength).ToArray();
        if (longEnough.Length == 0)
        {
            return longEnough;
        }

        var median = longEnough.Select(stretch => stretch.Length).Order().ElementAt((longEnough.Length - 1) / 2);
        return longEnough.Where(stretch => stretch.Length <= median * rules.OutlierFactor).ToArray();
    }

    private static TimeSpan LimitOf(IReadOnlyList<AwakeStretch> stretches, WakeWindowOptions rules) =>
        WeightedStatistics.RoundToMinute(WeightedStatistics.InterpolatedQuantile(stretches.Select(stretch => stretch.Length).ToArray(), rules.Percentile));

    /// <summary>The start of the awake stretch going on at <paramref name="now"/>, or <c>null</c> (see the rules).</summary>
    private static DateTimeOffset? AwakeSince(IReadOnlyList<ObservedEvent> sleepEvents, IReadOnlyList<ObservedEvent> sessions, DateTimeOffset now, WakeWindowOptions rules)
    {
        if (sessions.Any(session => session.EndedAt is not { } end || end > now))
        {
            return null;
        }

        var since = sessions.Select(session => session.EndedAt)
            .Concat(sleepEvents.Where(item => item.Kind == SleepKinds.WokeUp).Select(item => (DateTimeOffset?)item.StartedAt))
            .Max();
        return since is { } start && !IsAsleepOrUpInTheNight(sleepEvents, start, now, rules) ? start : null;
    }

    private static bool IsAsleepOrUpInTheNight(IReadOnlyList<ObservedEvent> sleepEvents, DateTimeOffset since, DateTimeOffset now, WakeWindowOptions rules) =>
        sleepEvents.Any(item =>
            (item.Kind == SleepKinds.FellAsleep && item.StartedAt > since && now - item.StartedAt <= rules.LoneMarkerMaxAge)
            || (item.Kind == SleepKinds.NightWaking && (item.EndedAt ?? now) >= since));
}
