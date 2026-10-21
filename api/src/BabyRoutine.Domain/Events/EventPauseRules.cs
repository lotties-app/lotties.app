using System.Globalization;
using System.Text.Json;
using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Events;

/// <summary>
/// Rules of the reserved pause keys (<see cref="PauseFields"/>), for every event type whether or not it declares them:
/// <c>pause_count</c> and <c>paused_seconds</c> are whole numbers within their bounds; once the event has ended
/// (<c>endedAt</c> set) <c>paused_seconds</c> cannot exceed the elapsed time and <c>paused_at</c> must be gone (clients
/// fold the open pause into <c>paused_seconds</c> on resume/stop); while it runs, <c>paused_at</c> is an ISO-8601 instant
/// with an offset. Absent or <c>null</c> members have no value. Throws <see cref="DomainValidationException"/> with the key.
/// </summary>
internal static class EventPauseRules
{
    public static void Ensure(EventPayload payload, DateTimeOffset startedAt, DateTimeOffset? endedAt)
    {
        using var document = JsonDocument.Parse(payload.Value);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        EnsureWholeNumber(PauseFields.PauseCount, Member(root, PauseFields.PauseCount), PauseFields.MaxPauseCount);
        var pausedSeconds = EnsureWholeNumber(PauseFields.PausedSeconds, Member(root, PauseFields.PausedSeconds), PauseFields.MaxPausedSeconds);
        EnsureWithinElapsed(pausedSeconds, startedAt, endedAt);
        EnsurePausedAt(Member(root, PauseFields.PausedAt), endedAt);
    }

    private static JsonElement? Member(JsonElement root, string key) =>
        root.TryGetProperty(key, out var value) && value.ValueKind != JsonValueKind.Null ? value : null;

    private static double? EnsureWholeNumber(string key, JsonElement? value, int max)
    {
        if (value is null)
        {
            return null;
        }

        var number = value.Value.ValueKind == JsonValueKind.Number && value.Value.TryGetDouble(out var parsed) ? parsed : double.NaN;
        return WholeNumbers.IsWhole(number) && number >= 0 && number <= max
            ? number
            : throw new DomainValidationException(key, $"'{key}' must be a whole number from 0 to {max.ToString(CultureInfo.InvariantCulture)}.");
    }

    private static void EnsureWithinElapsed(double? pausedSeconds, DateTimeOffset startedAt, DateTimeOffset? endedAt)
    {
        if (pausedSeconds is not null && endedAt is not null && pausedSeconds.Value > (endedAt.Value - startedAt).TotalSeconds)
        {
            throw new DomainValidationException(PauseFields.PausedSeconds, $"'{PauseFields.PausedSeconds}' cannot exceed the time between start and end.");
        }
    }

    private static void EnsurePausedAt(JsonElement? value, DateTimeOffset? endedAt)
    {
        if (value is null)
        {
            return;
        }

        if (endedAt is not null)
        {
            throw new DomainValidationException(PauseFields.PausedAt, $"'{PauseFields.PausedAt}' must be cleared when the event ends.");
        }

        if (value.Value.ValueKind != JsonValueKind.String || !IsoInstant.TryParse(value.Value.GetString(), out _))
        {
            throw new DomainValidationException(PauseFields.PausedAt, $"'{PauseFields.PausedAt}' must be an ISO-8601 instant with an offset.");
        }
    }
}
