using System.Globalization;
using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Events;

/// <summary>
/// A position in the delta-sync order of a baby's events, which is <c>(UpdatedAt, Id)</c> ascending. Rows strictly
/// after the position are returned, so a page boundary inside a run of equal <c>UpdatedAt</c> values skips nothing.
/// The wire form (<see cref="Value"/>) is opaque to clients: <c>{UpdatedAt UTC ticks}.{Id as 32 hex digits}</c>.
/// </summary>
public readonly record struct EventSyncCursor
{
    private const char Separator = '.';
    private const string Field = "after";

    private EventSyncCursor(DateTimeOffset updatedAt, Guid eventId)
    {
        UpdatedAt = updatedAt;
        EventId = eventId;
    }

    public DateTimeOffset UpdatedAt { get; }

    public Guid EventId { get; }

    public string Value => string.Create(CultureInfo.InvariantCulture, $"{UpdatedAt.UtcTicks}{Separator}{EventId:N}");

    /// <summary>The position just after <paramref name="lastDelivered"/>: continue with the rows that follow it.</summary>
    public static EventSyncCursor After(Event lastDelivered)
    {
        ArgumentNullException.ThrowIfNull(lastDelivered);
        return new EventSyncCursor(lastDelivered.UpdatedAt, lastDelivered.Id);
    }

    /// <summary>
    /// The position just before every event changed at or after <paramref name="since"/>. Event ids are never empty,
    /// so "after (since, empty id)" is exactly "UpdatedAt &gt;= since".
    /// </summary>
    public static EventSyncCursor AtOrAfter(DateTimeOffset since) => new(UtcTime.Normalize(since), Guid.Empty);

    /// <summary>Parses the wire form produced by <see cref="Value"/>.</summary>
    public static EventSyncCursor From(string? value)
    {
        var parts = (value ?? string.Empty).Split(Separator);
        return parts.Length == 2 && TryParseTicks(parts[0], out var updatedAt) && Guid.TryParseExact(parts[1], "N", out var eventId)
            ? new EventSyncCursor(updatedAt, eventId)
            : throw new DomainValidationException(Field, "The continuation cursor is not valid; pass back the value of the previous response unchanged.");
    }

    public override string ToString() => Value;

    private static bool TryParseTicks(string text, out DateTimeOffset updatedAt)
    {
        var parsed = long.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
            && ticks <= DateTimeOffset.MaxValue.UtcTicks;
        updatedAt = parsed ? new DateTimeOffset(ticks, TimeSpan.Zero) : default;
        return parsed;
    }
}
