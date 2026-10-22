using System.Globalization;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Prescriptions;

/// <summary>
/// The local reminder time of one part of the day; it lies inside the part's window (e.g. a morning reminder between
/// 05:00 and 11:59, a night reminder from 22:00 to 04:59).
/// </summary>
public sealed record DayPartReminder
{
    private DayPartReminder(DayPart part, TimeOnly time)
    {
        Part = part;
        Time = time;
    }

    public DayPart Part { get; }

    public TimeOnly Time { get; }

    /// <summary>Parses a part code and an <c>HH:mm</c> time; throws <see cref="DomainValidationException"/> (field <c>dayPartReminders</c>).</summary>
    public static DayPartReminder Parse(string? partCode, string? time)
    {
        if (!DayPartWindows.TryParse(partCode, out var part))
        {
            throw Invalid($"dayPartReminders parts must be morning, afternoon, evening or night, got '{partCode}'.");
        }

        return TimesOfDay.TryParseClockTime(time, out var parsed)
            ? Create(part, parsed)
            : throw Invalid($"dayPartReminders times must be HH:mm (00:00-23:59), got '{time}'.");
    }

    public static DayPartReminder Create(DayPart part, TimeOnly time)
    {
        if (!Enum.IsDefined(part) || time.Second != 0 || time.Millisecond != 0 || time.Microsecond != 0)
        {
            throw Invalid("dayPartReminders entries need a part and a whole-minute time.");
        }

        return DayPartWindows.PartAt(time) == part
            ? new DayPartReminder(part, time)
            : throw Invalid($"The {DayPartWindows.CodeOf(part)} reminder must be inside its window ({DayPartWindows.WindowText(part)}).");
    }

    public string TimeText => Time.ToString(TimesOfDay.Format, CultureInfo.InvariantCulture);

    private static DomainValidationException Invalid(string message) => new(DayPartReminders.Field, message);
}

/// <summary>
/// The optional reminders of a part-of-the-day prescription (off when absent): at most one per part, kept in the order
/// of the day. Every reminder must name one of the prescription's chosen parts (checked by
/// <see cref="PrescriptionSchedule"/>). Stored as <c>morning=08:00,night=22:00</c>; sent as
/// <c>[{"part":"morning","time":"08:00"}]</c>.
/// </summary>
public sealed record DayPartReminders
{
    public const string Field = "dayPartReminders";
    private const char EntrySeparator = ',';
    private const char TimeSeparator = '=';

    private DayPartReminders(IReadOnlyList<DayPartReminder> values)
    {
        Values = values;
    }

    public IReadOnlyList<DayPartReminder> Values { get; }

    public static DayPartReminders Create(IReadOnlyList<DayPartReminder> reminders)
    {
        ArgumentNullException.ThrowIfNull(reminders);
        if (reminders.Count == 0 || reminders.Count > DayPartWindows.All.Count || reminders.Select(reminder => reminder.Part).Distinct().Count() != reminders.Count)
        {
            throw new DomainValidationException(Field, "dayPartReminders must list each part at most once.");
        }

        return new DayPartReminders(reminders.OrderBy(reminder => reminder.Part).ToArray());
    }

    /// <summary>Restores the stored text (<see cref="ToStorage"/>).</summary>
    public static DayPartReminders FromStorage(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        return Create(text.Split(EntrySeparator).Select(ParseStored).ToArray());
    }

    public string ToStorage() => string.Join(EntrySeparator, Values.Select(reminder => $"{DayPartWindows.CodeOf(reminder.Part)}{TimeSeparator}{reminder.TimeText}"));

    /// <summary>The reminder time of <paramref name="part"/>, or <c>null</c> when it has none.</summary>
    public TimeOnly? TimeOf(DayPart part) => Values.FirstOrDefault(reminder => reminder.Part == part)?.Time;

    public bool Equals(DayPartReminders? other) => other is not null && Values.SequenceEqual(other.Values);

    public override int GetHashCode() => Values.Aggregate(Values.Count, HashCode.Combine);

    private static DayPartReminder ParseStored(string entry)
    {
        var separator = entry.IndexOf(TimeSeparator, StringComparison.Ordinal);
        return separator < 0
            ? throw new DomainValidationException(Field, $"Stored dayPartReminders entry '{entry}' is malformed.")
            : DayPartReminder.Parse(entry[..separator], entry[(separator + 1)..]);
    }
}
