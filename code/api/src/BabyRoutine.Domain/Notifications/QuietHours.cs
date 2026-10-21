using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Notifications;

/// <summary>
/// A user's quiet hours in their own time zone: <see cref="Start"/> inclusive to <see cref="End"/> exclusive, crossing
/// midnight when <see cref="Start"/> is later than <see cref="End"/>. Equal times are rejected. Default on, 22:00-07:00.
/// </summary>
public readonly record struct QuietHours
{
    private QuietHours(bool enabled, TimeOnly start, TimeOnly end)
    {
        Enabled = enabled;
        Start = start;
        End = end;
    }

    public static QuietHours Default { get; } = new(true, new TimeOnly(22, 0), new TimeOnly(7, 0));

    public bool Enabled { get; }

    public TimeOnly Start { get; }

    public TimeOnly End { get; }

    public static QuietHours Create(bool enabled, TimeOnly start, TimeOnly end) =>
        start == end
            ? throw new DomainValidationException("quietHours.end", "Quiet hours must start and end at different times.")
            : new QuietHours(enabled, start, end);

    /// <summary>Whether <paramref name="instant"/>, seen with the local <paramref name="utcOffset"/>, is inside enabled quiet hours.</summary>
    public bool Contains(DateTimeOffset instant, TimeSpan utcOffset) =>
        Enabled && TimeOnly.FromTimeSpan(instant.ToOffset(utcOffset).TimeOfDay).IsBetween(Start, End);
}
