namespace Lotties.Domain.Patterns;

/// <summary>
/// Finds a time of day an event keeps happening at (docs/design/11-patterns.md). Pure and deterministic; generic over
/// what the events are (belly pain today, fussiness or diapers later). Input = local wall-clock times of one event type
/// (converted by the caller with the family's time zone, so daylight saving changes are already applied) and the local
/// date of today. Rules, with <see cref="RecurringTimeOfDayOptions.Default"/>:
/// <list type="number">
/// <item>Only events on the last 14 local calendar days (today included) count.</item>
/// <item>Times of day sit on a 24-hour circle (23:50 and 00:10 are 20 minutes apart). The cluster centre is the event
/// time with the most days having an event within 90 minutes of it (ties: more events within 90 minutes, then the
/// smaller total distance of those events, then the earlier time).</item>
/// <item>A "day" is one occurrence around that centre: events up to 12 hours either side of the same usual time belong
/// to the same day, so a night around midnight counts once and several events of one day count once.</item>
/// <item>Each day's event closest to the centre (within 90 minutes) gives one sample; the usual time is their circular
/// mean and the spread their circular standard deviation. A spread over 45 minutes is no pattern.</item>
/// <item>The window is the usual time ± max(30 minutes, the spread), at most 3 hours wide.</item>
/// <item>Pattern only when at least 60 % of the days with an event have one inside the window and at least 4 of the
/// last 7 local days (today included) have one inside the window.</item>
/// <item>Confidence: high with 8 or more supporting days and a spread up to 30 minutes, medium with 6 or more, else low.</item>
/// </list>
/// </summary>
public static class RecurringTimeOfDayPattern
{
    private const int MinutesPerDay = CircularSummary.MinutesPerDay;
    private const int HalfDay = MinutesPerDay / 2;

    /// <param name="localTimes">Local wall-clock times of the events, in any order; times after today are ignored.</param>
    /// <param name="today">The local date of now.</param>
    public static TimeOfDayPattern? Detect(IEnumerable<DateTime> localTimes, DateOnly today, RecurringTimeOfDayOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(localTimes);
        var rules = options ?? RecurringTimeOfDayOptions.Default;
        var events = InLookBack(localTimes, today, rules);
        return ClusterCentre(events, rules) is { } centre ? PatternAround(events, centre, today, rules) : null;
    }

    private static IReadOnlyList<LocalEvent> InLookBack(IEnumerable<DateTime> localTimes, DateOnly today, RecurringTimeOfDayOptions rules)
    {
        var first = today.AddDays(1 - rules.LookBackDays);
        return localTimes
            .Where(time => DateOnly.FromDateTime(time) >= first && DateOnly.FromDateTime(time) <= today)
            .Select(LocalEvent.Of)
            .OrderBy(item => item.At)
            .ToArray();
    }

    /// <summary>The event time with the most calendar days having an event within the cluster radius of it.</summary>
    private static int? ClusterCentre(IReadOnlyList<LocalEvent> events, RecurringTimeOfDayOptions rules)
    {
        var radius = WholeMinutes(rules.ClusterRadius);
        var byDate = events.GroupBy(item => DateOnly.FromDateTime(item.At)).Select(day => day.Select(item => item.Minute).ToArray()).ToArray();
        return events
            .Select(item => item.Minute)
            .Distinct()
            .Select(minute => CentreCandidate.Of(minute, byDate, radius))
            .OrderByDescending(candidate => candidate.Days)
            .ThenByDescending(candidate => candidate.Events)
            .ThenBy(candidate => candidate.Distance)
            .ThenBy(candidate => candidate.Minute)
            .Select(candidate => (int?)candidate.Minute)
            .FirstOrDefault();
    }

    private static TimeOfDayPattern? PatternAround(IReadOnlyList<LocalEvent> events, int centre, DateOnly today, RecurringTimeOfDayOptions rules)
    {
        var days = events.GroupBy(item => DayOf(item, centre)).Select(day => day.ToArray()).ToArray();
        var samples = days.Select(day => ClosestTo(day, centre, WholeMinutes(rules.ClusterRadius))).OfType<LocalEvent>().ToArray();
        var circle = CircularSummary.Of(samples.Select(sample => sample.Minute).ToArray());
        if (circle.Spread > rules.MaximumSpread.TotalMinutes)
        {
            return null;
        }

        var halfWidth = HalfWidth(circle.Spread, rules);
        var supporting = days.Select(day => SupportingDay(day, circle.Mean, halfWidth)).OfType<PatternDay>().ToArray();
        var recent = supporting.Count(day => day.Date > today.AddDays(-rules.RecentDays));
        return IsPattern(supporting.Length, days.Length, recent, rules)
            ? Create(circle, halfWidth, supporting, days.Length, recent, rules)
            : null;
    }

    /// <summary>The day an event belongs to: the date of the nearest occurrence of the usual time (up to 12 hours away).</summary>
    private static DateOnly DayOf(LocalEvent item, int centre) => DateOnly.FromDateTime(item.At.AddMinutes(HalfDay - centre));

    private static LocalEvent? ClosestTo(IReadOnlyList<LocalEvent> day, int centre, int radius) =>
        day.Where(item => Distance(item.Minute, centre) <= radius)
            .OrderBy(item => Distance(item.Minute, centre))
            .ThenBy(item => item.At)
            .FirstOrDefault();

    private static PatternDay? SupportingDay(IReadOnlyList<LocalEvent> day, int mean, int halfWidth)
    {
        var inside = day.Where(item => Distance(item.Minute, mean) <= halfWidth).ToArray();
        return inside.Length == 0
            ? null
            : new PatternDay(DateOnly.FromDateTime(inside[0].At), inside.Select(item => item.Time).ToArray());
    }

    private static int HalfWidth(double spread, RecurringTimeOfDayOptions rules)
    {
        var wanted = Math.Max(WholeMinutes(rules.MinimumHalfWidth), (int)Math.Round(spread, MidpointRounding.AwayFromZero));
        return Math.Min(wanted, WholeMinutes(rules.MaximumWidth) / 2);
    }

    private static bool IsPattern(int supportingDays, int eventDays, int recentDays, RecurringTimeOfDayOptions rules) =>
        eventDays > 0
        && (double)supportingDays / eventDays >= rules.MinimumCoverage
        && recentDays >= rules.MinimumRecentDays;

    private static TimeOfDayPattern Create(CircularSummary circle, int halfWidth, IReadOnlyList<PatternDay> supporting, int eventDays, int recentDays, RecurringTimeOfDayOptions rules)
    {
        var spread = TimeSpan.FromMinutes(Math.Round(circle.Spread, MidpointRounding.AwayFromZero));
        return new TimeOfDayPattern(
            ClockOf(circle.Mean),
            ClockOf(circle.Mean - halfWidth),
            ClockOf(circle.Mean + halfWidth),
            spread,
            ConfidenceOf(supporting.Count, circle.Spread, rules),
            supporting,
            eventDays,
            recentDays);
    }

    private static PatternConfidence ConfidenceOf(int supportingDays, double spread, RecurringTimeOfDayOptions rules) =>
        supportingDays >= rules.HighConfidenceDays && spread <= rules.HighConfidenceSpread.TotalMinutes ? PatternConfidence.High
        : supportingDays >= rules.MediumConfidenceDays ? PatternConfidence.Medium
        : PatternConfidence.Low;

    /// <summary>Minutes between two times of day on the 24-hour circle (0 to 720).</summary>
    private static int Distance(int first, int second) => CircularSummary.Distance(first, second);

    private static int Modulo(int minute) => CircularSummary.Modulo(minute);

    private static TimeOnly ClockOf(int minute) => new(Modulo(minute) / 60, Modulo(minute) % 60);

    private static int WholeMinutes(TimeSpan value) => (int)Math.Round(value.TotalMinutes, MidpointRounding.AwayFromZero);

    /// <summary>An event's local time, truncated to the minute.</summary>
    private sealed record LocalEvent(DateTime At, int Minute)
    {
        public TimeOnly Time => new(Minute / 60, Minute % 60);

        public static LocalEvent Of(DateTime time) => new(time, (time.Hour * 60) + time.Minute);
    }

    /// <summary>A candidate centre: how many calendar days and events are near it, and how far those events are in total.</summary>
    private sealed record CentreCandidate(int Minute, int Days, int Events, int Distance)
    {
        public static CentreCandidate Of(int minute, IReadOnlyList<int[]> byDate, int radius)
        {
            var near = byDate.Select(day => day.Select(other => RecurringTimeOfDayPattern.Distance(other, minute)).Where(distance => distance <= radius).ToArray()).ToArray();
            return new CentreCandidate(minute, near.Count(day => day.Length > 0), near.Sum(day => day.Length), near.Sum(day => day.Sum()));
        }
    }
}
