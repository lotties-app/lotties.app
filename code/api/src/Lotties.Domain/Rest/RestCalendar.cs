namespace Lotties.Domain.Rest;

/// <summary>A span of UTC instants, <see cref="Start"/> inclusive and <see cref="End"/> exclusive.</summary>
public readonly record struct RestInterval(DateTimeOffset Start, DateTimeOffset End)
{
    public bool Overlaps(RestInterval other) => Start < other.End && other.Start < End;

    /// <summary>How much of this interval lies inside <paramref name="other"/> (zero when they do not overlap).</summary>
    public TimeSpan OverlapWith(RestInterval other)
    {
        var start = Start > other.Start ? Start : other.Start;
        var end = End < other.End ? End : other.End;
        return end > start ? end - start : TimeSpan.Zero;
    }
}

/// <summary>
/// Where a person's night and work windows fall in UTC (docs/design/41-caregiver-rest.md sections 3 and 8). Shared by the
/// one-night estimate and the history so both place the night the same way. Pure: the zone comes from the settings.
/// </summary>
public static class RestCalendar
{
    /// <summary>How far before a night starts the events read for it reach (a sleep that began earlier can still be running).</summary>
    public static readonly TimeSpan EventLookBack = TimeSpan.FromHours(12);

    /// <summary>How far after a night ends the events read for it reach (R5, the first event of the day).</summary>
    public static readonly TimeSpan EventLookAhead = TimeSpan.FromHours(6);

    /// <summary>
    /// The UTC instant of a local wall-clock time. A gap time (spring forward) gets the standard offset, so it lands just after
    /// the gap; an ambiguous time the standard (later) one.
    /// </summary>
    public static DateTimeOffset ToUtc(TimeZoneInfo zone, DateOnly date, TimeOnly time)
    {
        ArgumentNullException.ThrowIfNull(zone);
        var local = DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified);
        var offset = zone.GetUtcOffset(local);
        return new DateTimeOffset(local - offset, TimeSpan.Zero);
    }

    public static TimeZoneInfo Zone(RestSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return TimeZoneInfo.FindSystemTimeZoneById(settings.TimeZone);
    }

    /// <summary>The night window of <paramref name="night"/> (the local date it starts); an end at or before the start is on the next day.</summary>
    public static RestInterval NightWindow(RestSettings settings, DateOnly night)
    {
        var zone = Zone(settings);
        var endDate = settings.NightEnd <= settings.NightStart ? night.AddDays(1) : night;
        return new RestInterval(ToUtc(zone, night, settings.NightStart), ToUtc(zone, endDate, settings.NightEnd));
    }

    /// <summary>The window of events one night reads: the night window widened by <see cref="EventLookBack"/> and <see cref="EventLookAhead"/>.</summary>
    public static RestInterval EventWindow(RestSettings settings, DateOnly night)
    {
        var window = NightWindow(settings, night);
        return new RestInterval(window.Start - EventLookBack, window.End + EventLookAhead);
    }

    /// <summary>
    /// The person's work windows from two days before <paramref name="night"/> to three days after it, as UTC intervals (R6:
    /// a window whose end is not after its start runs into the next day; days are ISO 1 = Monday to 7 = Sunday).
    /// </summary>
    public static IReadOnlyList<RestInterval> WorkWindows(RestSettings settings, DateOnly night)
    {
        var zone = Zone(settings);
        var spans = new List<RestInterval>();
        for (var day = night.AddDays(-2); day <= night.AddDays(3); day = day.AddDays(1))
        {
            spans.AddRange(WorkWindowsOn(settings, zone, day));
        }

        return spans;
    }

    private static IEnumerable<RestInterval> WorkWindowsOn(RestSettings settings, TimeZoneInfo zone, DateOnly day)
    {
        var iso = day.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)day.DayOfWeek;
        return settings.WorkWindows
            .Where(window => window.Days.Contains(iso))
            .Select(window => new RestInterval(
                ToUtc(zone, day, window.Start),
                ToUtc(zone, window.End <= window.Start ? day.AddDays(1) : day, window.End)));
    }
}
