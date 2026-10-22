using System.Globalization;

namespace Lotties.Domain.Prescriptions;

/// <summary>
/// A part of the baby's day for prescriptions such as "1 drop in the morning", where the clock time does not matter.
/// Codes (<see cref="DayPartWindows.CodeOf"/>): <c>morning</c>, <c>afternoon</c>, <c>evening</c>, <c>night</c>.
/// </summary>
public enum DayPart
{
    Morning,
    Afternoon,
    Evening,
    Night,
}

/// <summary>
/// The window of <see cref="Part"/> on the routine day <see cref="Day"/>: from <see cref="Start"/> (inclusive) to
/// <see cref="End"/> (exclusive), as instants. The night of a day ends on the next calendar date.
/// </summary>
public sealed record DayPartWindow(DayPart Part, DateOnly Day, DateTimeOffset Start, DateTimeOffset End)
{
    public bool Contains(DateTimeOffset instant) => instant >= Start && instant < End;
}

/// <summary>The routine day and the part of the day an instant falls in (see <see cref="DayPartWindows.Of"/>).</summary>
public readonly record struct DayPartOfDay(DateOnly Day, DayPart Part);

/// <summary>
/// The fixed windows of the parts of the day in the baby's local time, the only place they are defined (mirrored by
/// code/web/src/medications/dayParts.ts): morning 05:00-12:00, afternoon 12:00-18:00, evening 18:00-22:00, night
/// 22:00-05:00 (crossing midnight). A routine day starts at 05:00, so the night from 22:00 to 05:00 belongs to the day it
/// started on. Pure: the local time is the instant seen with a fixed UTC offset (the caller passes the offset at the
/// instant, so daylight saving time moves the windows with the wall clock).
/// </summary>
public static class DayPartWindows
{
    public static readonly TimeOnly MorningStart = new(5, 0);
    public static readonly TimeOnly AfternoonStart = new(12, 0);
    public static readonly TimeOnly EveningStart = new(18, 0);
    public static readonly TimeOnly NightStart = new(22, 0);

    /// <summary>Every part, in the order of the day.</summary>
    public static IReadOnlyList<DayPart> All { get; } = [DayPart.Morning, DayPart.Afternoon, DayPart.Evening, DayPart.Night];

    /// <summary>The local time where the part starts.</summary>
    public static TimeOnly StartOf(DayPart part) => part switch
    {
        DayPart.Morning => MorningStart,
        DayPart.Afternoon => AfternoonStart,
        DayPart.Evening => EveningStart,
        DayPart.Night => NightStart,
        _ => throw new ArgumentOutOfRangeException(nameof(part), part, "Unknown day part."),
    };

    /// <summary>The local time where the part ends (exclusive): the start of the next part.</summary>
    public static TimeOnly EndOf(DayPart part) => part switch
    {
        DayPart.Morning => AfternoonStart,
        DayPart.Afternoon => EveningStart,
        DayPart.Evening => NightStart,
        DayPart.Night => MorningStart,
        _ => throw new ArgumentOutOfRangeException(nameof(part), part, "Unknown day part."),
    };

    /// <summary>The suggested reminder time of a part when reminders are turned on: 08:00, 14:00, 19:00 and 22:00.</summary>
    public static TimeOnly DefaultReminderOf(DayPart part) => part switch
    {
        DayPart.Morning => new TimeOnly(8, 0),
        DayPart.Afternoon => new TimeOnly(14, 0),
        DayPart.Evening => new TimeOnly(19, 0),
        DayPart.Night => new TimeOnly(22, 0),
        _ => throw new ArgumentOutOfRangeException(nameof(part), part, "Unknown day part."),
    };

    /// <summary>The part a local time of day falls in (before 05:00 is night).</summary>
    public static DayPart PartAt(TimeOnly time) =>
        time >= NightStart || time < MorningStart ? DayPart.Night
        : time >= EveningStart ? DayPart.Evening
        : time >= AfternoonStart ? DayPart.Afternoon
        : DayPart.Morning;

    /// <summary>The routine day and part of <paramref name="instant"/> seen with <paramref name="utcOffset"/>; before 05:00 it is the previous day's night.</summary>
    public static DayPartOfDay Of(DateTimeOffset instant, TimeSpan utcOffset)
    {
        var local = instant.ToOffset(utcOffset).DateTime;
        var time = TimeOnly.FromDateTime(local);
        var date = DateOnly.FromDateTime(local);
        return new DayPartOfDay(time < MorningStart ? date.AddDays(-1) : date, PartAt(time));
    }

    /// <summary>The window of <paramref name="part"/> on the routine day <paramref name="day"/>.</summary>
    public static DayPartWindow WindowOf(DateOnly day, DayPart part, TimeSpan utcOffset) =>
        new(part, day, InstantIn(day, part, StartOf(part), utcOffset), part == DayPart.Night ? Instant(day.AddDays(1), MorningStart, utcOffset) : Instant(day, EndOf(part), utcOffset));

    /// <summary>The instant of the local <paramref name="time"/> inside the part's window of the routine day (a night time before 05:00 is on the next date).</summary>
    public static DateTimeOffset InstantIn(DateOnly day, DayPart part, TimeOnly time, TimeSpan utcOffset) =>
        Instant(part == DayPart.Night && time < MorningStart ? day.AddDays(1) : day, time, utcOffset);

    /// <summary>The stable lower-case code of the part.</summary>
    public static string CodeOf(DayPart part) => part switch
    {
        DayPart.Morning => "morning",
        DayPart.Afternoon => "afternoon",
        DayPart.Evening => "evening",
        DayPart.Night => "night",
        _ => throw new ArgumentOutOfRangeException(nameof(part), part, "Unknown day part."),
    };

    /// <summary>The part named by <paramref name="code"/> (exact lower-case code); <c>false</c> for anything else.</summary>
    public static bool TryParse(string? code, out DayPart part)
    {
        part = All.FirstOrDefault(candidate => CodeOf(candidate) == code);
        return code is not null && CodeOf(part) == code;
    }

    /// <summary>"05:00-12:00": the window as local times, for validation messages.</summary>
    public static string WindowText(DayPart part) =>
        $"{StartOf(part).ToString(TimesOfDay.Format, CultureInfo.InvariantCulture)}-{EndOf(part).ToString(TimesOfDay.Format, CultureInfo.InvariantCulture)}";

    private static DateTimeOffset Instant(DateOnly day, TimeOnly time, TimeSpan utcOffset) =>
        new DateTimeOffset(day.ToDateTime(time), utcOffset).ToUniversalTime();
}
