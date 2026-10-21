using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Notifications;

/// <summary>
/// A user's IANA time zone id (e.g. <c>America/Sao_Paulo</c>), known to the host's time zone database. Reminder times
/// and quiet hours are evaluated with its offset at the tick instant (<see cref="OffsetAt"/>).
/// </summary>
public readonly record struct NotificationTimeZone
{
    public const int MaxLength = 64;

    private NotificationTimeZone(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static NotificationTimeZone From(string? value) =>
        TryFrom(value, out var zone) ? zone : throw new DomainValidationException("timeZone", "timeZone must be a known IANA time zone id.");

    public static bool TryFrom(string? value, out NotificationTimeZone zone)
    {
        var trimmed = value?.Trim();
        var known = !string.IsNullOrEmpty(trimmed)
            && trimmed.Length <= MaxLength
            && !trimmed.Contains(Text.Nul, StringComparison.Ordinal)
            && TimeZoneInfo.TryFindSystemTimeZoneById(trimmed, out var found)
            && found.HasIanaId;
        zone = known ? new NotificationTimeZone(trimmed!) : default;
        return known;
    }

    /// <summary>The zone's UTC offset at <paramref name="instant"/> (daylight saving time included).</summary>
    public TimeSpan OffsetAt(DateTimeOffset instant) => TimeZoneInfo.FindSystemTimeZoneById(Value).GetUtcOffset(instant);

    public override string ToString() => Value;
}
