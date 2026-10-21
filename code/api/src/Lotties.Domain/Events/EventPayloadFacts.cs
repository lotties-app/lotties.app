using System.Text.Json;
using Lotties.Domain.Common;

namespace Lotties.Domain.Events;

/// <summary>
/// The payload members the domain interprets beyond the type's field rules: the sleep <c>kind</c> and the pause keys
/// (<see cref="PauseFields"/>). Read leniently, because stored payloads may predate the rules: a member that is absent,
/// <c>null</c>, of the wrong JSON kind or out of range reads as no value (<c>null</c> / 0).
/// </summary>
public sealed record EventPayloadFacts(string? Kind, int PauseCount, int PausedSeconds, DateTimeOffset? PausedAt)
{
    private const string KindMember = "kind";

    public static EventPayloadFacts None { get; } = new(null, 0, 0, null);

    /// <summary>Total length of the finished pauses.</summary>
    public TimeSpan Paused => TimeSpan.FromSeconds(PausedSeconds);

    public static EventPayloadFacts Read(EventPayload payload)
    {
        using var document = JsonDocument.Parse(payload.Value);
        var root = document.RootElement;
        return root.ValueKind != JsonValueKind.Object
            ? None
            : new EventPayloadFacts(
                Text(root, KindMember),
                WholeNumber(root, PauseFields.PauseCount, PauseFields.MaxPauseCount),
                WholeNumber(root, PauseFields.PausedSeconds, PauseFields.MaxPausedSeconds),
                Instant(root, PauseFields.PausedAt));
    }

    private static string? Text(JsonElement root, string key) =>
        root.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static int WholeNumber(JsonElement root, string key, int max) =>
        root.TryGetProperty(key, out var value)
        && value.ValueKind == JsonValueKind.Number
        && value.TryGetDouble(out var number)
        && WholeNumbers.IsWhole(number)
        && number >= 0
        && number <= max
            ? (int)number
            : 0;

    private static DateTimeOffset? Instant(JsonElement root, string key) =>
        IsoInstant.TryParse(Text(root, key), out var instant) ? instant.ToUniversalTime() : null;
}
