using Lotties.Domain.Common;

namespace Lotties.Domain.Patterns;

/// <summary>
/// Turns instants into the family's local wall-clock times: with a time zone, each instant gets the offset in force at
/// that instant (daylight saving changes inside the look-back are applied); without one, a fixed UTC offset is used.
/// </summary>
public sealed class LocalClock
{
    private const int MaxZoneIdLength = 64;

    private readonly TimeZoneInfo? _zone;
    private readonly TimeSpan _offset;

    private LocalClock(TimeZoneInfo? zone, TimeSpan offset)
    {
        _zone = zone;
        _offset = offset;
    }

    /// <summary>The zone's id, or <c>null</c> for a fixed offset.</summary>
    public string? TimeZoneId => _zone?.Id;

    public static LocalClock InZone(TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);
        return new LocalClock(zone, TimeSpan.Zero);
    }

    public static LocalClock WithOffset(TimeSpan offset) => new(null, offset);

    /// <summary>
    /// The clock of the IANA zone <paramref name="timeZoneId"/> when the host knows it (trimmed, at most 64 characters),
    /// else of the fixed <paramref name="fallbackOffset"/>.
    /// </summary>
    public static LocalClock ForZoneOrOffset(string? timeZoneId, TimeSpan fallbackOffset) =>
        FindIanaZone(timeZoneId) is { } zone ? InZone(zone) : WithOffset(fallbackOffset);

    /// <summary>The local wall-clock time of <paramref name="instant"/>.</summary>
    public DateTime ToLocal(DateTimeOffset instant) =>
        (_zone is null ? instant.ToOffset(_offset) : TimeZoneInfo.ConvertTime(instant, _zone)).DateTime;

    /// <summary>The local date of <paramref name="instant"/>.</summary>
    public DateOnly DateOf(DateTimeOffset instant) => DateOnly.FromDateTime(ToLocal(instant));

    private static TimeZoneInfo? FindIanaZone(string? timeZoneId)
    {
        var trimmed = timeZoneId?.Trim();
        if (string.IsNullOrEmpty(trimmed) || trimmed.Length > MaxZoneIdLength || trimmed.Contains(Text.Nul, StringComparison.Ordinal))
        {
            return null;
        }

        return TimeZoneInfo.TryFindSystemTimeZoneById(trimmed, out var zone) && zone.HasIanaId ? zone : null;
    }
}
