using System.Globalization;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Appointments;

/// <summary>
/// When reminders of an appointment go, in minutes before its start: any of 1 week (10080), 1 day (1440), 2 hours (120)
/// and 30 minutes (30), each at most once; none is allowed. Stored largest first. Absent on a write = <see cref="Default"/>
/// (1 day and 2 hours). Compared by value.
/// </summary>
public sealed class AppointmentReminders : IEquatable<AppointmentReminders>
{
    public const string Field = "reminderOffsetsMinutes";

    /// <summary>The longest storage text, <c>10080,1440,120,30</c>.</summary>
    public const int StorageMaxLength = 20;

    public static readonly IReadOnlyList<int> AllowedMinutes = [10080, 1440, 120, 30];

    private readonly int[] _minutes;

    private AppointmentReminders(IEnumerable<int> minutes)
    {
        _minutes = minutes.OrderDescending().ToArray();
    }

    /// <summary>1 day and 2 hours before.</summary>
    public static AppointmentReminders Default { get; } = new([1440, 120]);

    public static AppointmentReminders None { get; } = new([]);

    /// <summary>The offsets in minutes before the start, largest first.</summary>
    public IReadOnlyList<int> Minutes => _minutes;

    /// <summary>Validates <paramref name="minutes"/>; <c>null</c> is <see cref="Default"/>. 400 <c>validation_failed</c> on an unknown or repeated offset.</summary>
    public static AppointmentReminders From(IReadOnlyCollection<int>? minutes)
    {
        if (minutes is null)
        {
            return Default;
        }

        if (minutes.Any(offset => !AllowedMinutes.Contains(offset)))
        {
            throw new DomainValidationException(Field, $"{Field} may only hold {string.Join(", ", AllowedMinutes)}.");
        }

        return minutes.Distinct().Count() == minutes.Count
            ? new AppointmentReminders(minutes)
            : throw new DomainValidationException(Field, $"{Field} must not repeat an offset.");
    }

    /// <summary>Comma-separated minutes, largest first (empty text for none).</summary>
    public string ToStorage() => string.Join(',', _minutes.Select(offset => offset.ToString(CultureInfo.InvariantCulture)));

    public static AppointmentReminders FromStorage(string value) =>
        string.IsNullOrEmpty(value)
            ? None
            : From(value.Split(',').Select(part => int.Parse(part, NumberStyles.None, CultureInfo.InvariantCulture)).ToArray());

    public bool Equals(AppointmentReminders? other) => other is not null && _minutes.SequenceEqual(other._minutes);

    public override bool Equals(object? obj) => Equals(obj as AppointmentReminders);

    public override int GetHashCode() => _minutes.Aggregate(0, HashCode.Combine);

    public override string ToString() => ToStorage();
}
