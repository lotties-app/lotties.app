using System.Collections.Frozen;
using System.Text.Json;
using Lotties.Domain.Common;

namespace Lotties.Domain.Events;

/// <summary>
/// The one change a member who logs events but did not log this one (a Caregiver) may make to it: stop, pause or
/// resume it while it runs. Allowed only when the stored event is running and the edit keeps its type, start and
/// notes; ends it at or after its start and at most <see cref="ClientEditTime.MaxFutureSkew"/> ahead of the server
/// clock (or keeps it running); changes only the pause keys (<see cref="PauseFields"/>) and the bottle's drinking
/// stretches (<see cref="BottleSegments"/>, written at each pause and at the stop; only added to or given a level, never
/// rewritten: <see cref="BottleHistory.OnlyExtends"/>, docs/design/44-bottle-history.md rule 7) and otherwise only fills
/// payload members that were absent, <c>null</c> or <c>""</c> (what the stop flow asks, e.g. a bottle's amount).
/// Every other stored payload value must stay (as a JSON value).
/// </summary>
public static class RunningEventControl
{
    private static readonly FrozenSet<string> PauseKeys =
        new[] { PauseFields.PauseCount, PauseFields.PausedSeconds, PauseFields.PausedAt, BottleSegments.Member }.ToFrozenSet(StringComparer.Ordinal);

    public static bool Allows(Event stored, EventEdit edit, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(stored);
        ArgumentNullException.ThrowIfNull(edit);
        return stored.IsRunning
            && stored.TypeId == edit.TypeId
            && stored.StartedAt == UtcTime.Normalize(edit.StartedAt)
            && string.Equals(stored.Notes, NormalizedNotes(edit.Notes), StringComparison.Ordinal)
            && EndsAllowed(stored.StartedAt, edit.EndedAt, now)
            && KeepsStoredValues(stored.Payload, edit.Payload)
            && BottleHistory.OnlyExtends(stored.Payload.GetString(BottleSegments.Member), edit.Payload.GetString(BottleSegments.Member));
    }

    /// <summary>Notes as the event would store them (trimmed, blank = none).</summary>
    internal static string? NormalizedNotes(string? notes)
    {
        var trimmed = notes?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static bool EndsAllowed(DateTimeOffset startedAt, DateTimeOffset? endedAt, DateTimeOffset now) =>
        endedAt is not { } end
        || (UtcTime.Normalize(end) >= startedAt && UtcTime.Normalize(end) <= UtcTime.Normalize(now) + ClientEditTime.MaxFutureSkew);

    private static bool KeepsStoredValues(EventPayload stored, EventPayload edited)
    {
        using var before = JsonDocument.Parse(stored.Value);
        using var after = JsonDocument.Parse(edited.Value);
        return before.RootElement.ValueKind == JsonValueKind.Object
            && after.RootElement.ValueKind == JsonValueKind.Object
            && before.RootElement.EnumerateObject().All(member => IsKept(member, after.RootElement));
    }

    private static bool IsKept(JsonProperty member, JsonElement edited) =>
        PauseKeys.Contains(member.Name)
        || IsEmpty(member.Value)
        || (edited.TryGetProperty(member.Name, out var value) && JsonEquivalence.AreEquivalent(member.Value, value));

    private static bool IsEmpty(JsonElement value) =>
        value.ValueKind == JsonValueKind.Null
        || (value.ValueKind == JsonValueKind.String && value.GetString()!.Length == 0);
}
