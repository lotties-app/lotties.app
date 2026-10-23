using Lotties.Domain.Patterns;

namespace Lotties.Domain.Clinical;

/// <summary>
/// One local calendar day as the family lives it: from its local midnight to the next one, so across a daylight saving
/// change it is 23 or 25 hours long and every bucket still starts at local midnight (never a 24-hour step).
/// </summary>
public sealed record ClinicalDay(DateOnly Date, DateTimeOffset Start, DateTimeOffset End)
{
    public long StartMs => Start.ToUnixTimeMilliseconds();

    public long EndMs => End.ToUnixTimeMilliseconds();

    /// <summary>Whether <paramref name="instant"/> falls inside the day (start included, end excluded).</summary>
    public bool Contains(DateTimeOffset instant) => instant >= Start && instant < End;
}

/// <summary>
/// The local days a clinical summary is taken over, with the clock that made them and "now". Mirrors the parents'
/// Insights (<c>days.ts</c>): <see cref="Today"/> is the local date of now, which averages leave out unless it is the only day with data.
/// </summary>
public sealed class ClinicalWindow
{
    private ClinicalWindow(IReadOnlyList<ClinicalDay> days, LocalClock clock, DateTimeOffset now)
    {
        Days = days;
        Clock = clock;
        Now = now;
        Today = clock.DateOf(now);
    }

    public IReadOnlyList<ClinicalDay> Days { get; }

    public LocalClock Clock { get; }

    public DateTimeOffset Now { get; }

    /// <summary>The local date of <see cref="Now"/>.</summary>
    public DateOnly Today { get; }

    public long NowMs => Now.ToUnixTimeMilliseconds();

    /// <summary>Local midnight that starts the first day.</summary>
    public DateTimeOffset Start => Days[0].Start;

    /// <summary>Local midnight that ends the last day.</summary>
    public DateTimeOffset End => Days[^1].End;

    public static ClinicalWindow Create(ClinicalRange range, LocalClock clock, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(range);
        ArgumentNullException.ThrowIfNull(clock);
        var days = Enumerable.Range(0, range.DayCount).Select(offset => DayOf(range.From.AddDays(offset), clock)).ToArray();
        return new ClinicalWindow(days, clock, now);
    }

    /// <summary>The local wall-clock <paramref name="hour"/> on <paramref name="day"/> shifted by <paramref name="dayOffset"/> days, as an instant.</summary>
    public DateTimeOffset At(ClinicalDay day, int hour, int dayOffset = 0) =>
        Clock.ToInstant(day.Date.AddDays(dayOffset).ToDateTime(new TimeOnly(hour, 0)));

    private static ClinicalDay DayOf(DateOnly date, LocalClock clock) =>
        new(date, clock.ToInstant(date.ToDateTime(TimeOnly.MinValue)), clock.ToInstant(date.AddDays(1).ToDateTime(TimeOnly.MinValue)));
}
