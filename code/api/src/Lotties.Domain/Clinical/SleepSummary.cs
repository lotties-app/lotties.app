using Lotties.Domain.Predictions;

namespace Lotties.Domain.Clinical;

/// <summary>
/// Sleep of one local day in milliseconds: the night and nap time inside the day (a session across midnight is split
/// between the days by its instants, pauses removed, a running sleep counted until now), the naps that started that day
/// and the longest single session that started that day (effective, whole).
/// </summary>
public sealed record SleepDaySummary(DateOnly Date, double NightMs, double NapMs, int Naps, double LongestMs)
{
    public double TotalMs => NightMs + NapMs;
}

/// <summary>
/// The sleep of a range, as the parents' Insights compute it (<c>sleepModel.ts</c>): per-day totals, the averages over
/// <see cref="ClinicalStatistics.CompletedDaysWithData{TDay}"/> (<see cref="DaysCounted"/> days; <c>null</c> without any), the
/// longest session that started in the range and the usual bedtime and wake-up (medians of the daily ones).
/// </summary>
public sealed record SleepSummary(
    IReadOnlyList<SleepDaySummary> Days,
    double? AverageNightMs,
    double? AverageNapMs,
    double? NapsPerDay,
    int DaysCounted,
    double? LongestStretchMs,
    DateTimeOffset? LongestStretchStartedAt,
    TimeOnly? BedtimeMedian,
    TimeOnly? WakeMedian)
{
    /// <summary>Average night plus average nap time, or <c>null</c> without counted days.</summary>
    public double? AverageTotalMs => AverageNightMs is null ? null : AverageNightMs + (AverageNapMs ?? 0);
}

/// <summary>Computes the <see cref="SleepSummary"/>; pure, no I/O.</summary>
public static class SleepSummaries
{
    private const int MinutesPerDay = 24 * 60;
    private const int NoonMinutes = 12 * 60;
    private const int BedtimeFromHour = 15;
    private const int BedtimeToHourNextDay = 3;
    private const int WakeFromHour = 3;
    private const int WakeToHour = 12;
    private const int MarkerWakeFromHour = 4;
    private const int MarkerWakeToHour = 11;

    /// <param name="observed">The baby's non-deleted sleep events (those starting after now are ignored).</param>
    /// <param name="window">The local days to cover.</param>
    public static SleepSummary Summarize(IReadOnlyList<SleepObservation> observed, ClinicalWindow window)
    {
        ArgumentNullException.ThrowIfNull(observed);
        ArgumentNullException.ThrowIfNull(window);
        var live = observed.Where(item => item.StartedAt <= window.Now).ToArray();
        var sessions = live.Where(item => item.IsSession).ToArray();
        var days = window.Days.Select(day => SummarizeDay(day, sessions, window)).ToArray();
        var counted = ClinicalStatistics.CompletedDaysWithData(days, day => day.TotalMs > 0, day => day.Date, window.Today);
        var longest = LongestSession(sessions, window);
        return new SleepSummary(
            days,
            ClinicalStatistics.Mean(counted.Select(day => day.NightMs).ToArray()),
            ClinicalStatistics.Mean(counted.Select(day => day.NapMs).ToArray()),
            ClinicalStatistics.Mean(counted.Select(day => (double)day.Naps).ToArray()),
            counted.Count,
            longest is null ? null : longest.EffectiveSeconds(window.NowMs) * 1000d,
            longest?.StartedAt,
            BedtimeMedian(live, window),
            WakeMedian(live, window));
    }

    private static SleepDaySummary SummarizeDay(ClinicalDay day, IReadOnlyList<SleepObservation> sessions, ClinicalWindow window)
    {
        var overlapping = sessions.Where(item => item.StartMs < day.EndMs && item.EndMsOr(window.NowMs) > day.StartMs).ToArray();
        var startedToday = sessions.Where(item => day.Contains(item.StartedAt)).ToArray();
        return new SleepDaySummary(
            day.Date,
            overlapping.Where(item => item.IsNight).Sum(item => item.EffectiveMsInWindow(day.StartMs, day.EndMs, window.NowMs)),
            overlapping.Where(item => !item.IsNight).Sum(item => item.EffectiveMsInWindow(day.StartMs, day.EndMs, window.NowMs)),
            startedToday.Count(item => !item.IsNight),
            startedToday.Select(item => item.EffectiveSeconds(window.NowMs) * 1000d).DefaultIfEmpty(0).Max());
    }

    /// <summary>The session with the longest effective time that started in the range (the earliest on a tie).</summary>
    private static SleepObservation? LongestSession(IReadOnlyList<SleepObservation> sessions, ClinicalWindow window) =>
        sessions
            .Where(item => item.StartedAt >= window.Start && item.StartedAt < window.End)
            .OrderByDescending(item => item.EffectiveSeconds(window.NowMs))
            .ThenBy(item => item.StartedAt)
            .FirstOrDefault();

    private static TimeOnly? BedtimeMedian(IReadOnlyList<SleepObservation> live, ClinicalWindow window)
    {
        var bedtimes = window.Days.Select(day => BedtimeOf(day, live, window)).OfType<DateTimeOffset>().ToArray();
        return UsualClock(bedtimes, fromNoon: true, window);
    }

    private static TimeOnly? WakeMedian(IReadOnlyList<SleepObservation> live, ClinicalWindow window)
    {
        var wakes = window.Days.Select(day => WakeOf(day, live, window)).OfType<DateTimeOffset>().ToArray();
        return UsualClock(wakes, fromNoon: false, window);
    }

    /// <summary>
    /// Bedtime of the evening of <paramref name="day"/>: the earliest <c>bed_time</c> marker from 15:00 to 03:00 the next
    /// day, else the earliest night that started then.
    /// </summary>
    private static DateTimeOffset? BedtimeOf(ClinicalDay day, IReadOnlyList<SleepObservation> live, ClinicalWindow window)
    {
        var from = window.At(day, BedtimeFromHour);
        var to = window.At(day, BedtimeToHourNextDay, dayOffset: 1);
        var inEvening = live.Where(item => item.StartedAt >= from && item.StartedAt < to).ToArray();
        return EarliestStart(inEvening.Where(item => item.IsKind(SleepKinds.BedTime))) ?? EarliestStart(inEvening.Where(item => item.IsNight));
    }

    /// <summary>
    /// Wake-up on the morning of <paramref name="day"/>: the latest end of a night from 03:00 to 12:00, else the earliest
    /// <c>woke_up</c> marker from 04:00 to 11:00.
    /// </summary>
    private static DateTimeOffset? WakeOf(ClinicalDay day, IReadOnlyList<SleepObservation> live, ClinicalWindow window)
    {
        var from = window.At(day, WakeFromHour);
        var to = window.At(day, WakeToHour);
        var nightEnds = live.Where(item => item.IsNight).Select(item => item.EndedAt).OfType<DateTimeOffset>().Where(end => end >= from && end < to);
        var markerFrom = window.At(day, MarkerWakeFromHour);
        var markerTo = window.At(day, MarkerWakeToHour);
        var markers = live.Where(item => item.IsKind(SleepKinds.WokeUp) && item.StartedAt >= markerFrom && item.StartedAt < markerTo);
        return nightEnds.Select(end => (DateTimeOffset?)end).Max() ?? EarliestStart(markers);
    }

    private static DateTimeOffset? EarliestStart(IEnumerable<SleepObservation> items) => items.Select(item => (DateTimeOffset?)item.StartedAt).Min();

    /// <summary>
    /// The usual clock time of a set of instants: the median of their local minutes after midnight. Bedtimes are measured
    /// from noon so 23:30 and 00:30 average to midnight, not to noon.
    /// </summary>
    private static TimeOnly? UsualClock(IReadOnlyList<DateTimeOffset> instants, bool fromNoon, ClinicalWindow window)
    {
        var shift = fromNoon ? NoonMinutes : 0;
        var values = instants.Select(instant => (double)((ClockMinutes(instant, window) - shift + MinutesPerDay) % MinutesPerDay)).ToArray();
        return ClinicalStatistics.Median(values) is { } middle ? ClockOf(middle + shift) : null;
    }

    private static int ClockMinutes(DateTimeOffset instant, ClinicalWindow window)
    {
        var local = window.Clock.ToLocal(instant);
        return (local.Hour * 60) + local.Minute;
    }

    private static TimeOnly ClockOf(double minutes)
    {
        var whole = (int)(ClinicalStatistics.RoundHalfUp(minutes) % MinutesPerDay);
        return new TimeOnly(whole / 60, whole % 60);
    }
}
