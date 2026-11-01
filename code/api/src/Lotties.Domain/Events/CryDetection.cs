using System.Text.Json;

namespace Lotties.Domain.Events;

/// <summary>
/// The cry monitor's marks on a fussy spell (docs/design/31-cry-detector-spike.md section 8): the hidden optional booleans
/// <c>auto_detected</c> (the monitor started the spell) and <c>cry_confirmed</c> (the parent's answer: <c>true</c> =
/// "Yes, crying", <c>false</c> = "Not crying"; absent until answered). Read leniently: a member that is absent,
/// <c>null</c> or not a boolean reads as no value.
/// </summary>
public sealed record CryDetection(bool AutoDetected, bool? Confirmed)
{
    public const string AutoDetectedMember = "auto_detected";
    public const string ConfirmedMember = "cry_confirmed";

    public static CryDetection None { get; } = new(false, null);

    /// <summary>A spell the monitor started that no parent marked as "Not crying".</summary>
    public bool IsOpenDetection => AutoDetected && Confirmed != false;

    /// <summary>
    /// Whether the spell counts as crying in patterns, pattern heads-ups and crying totals: every spell except one a
    /// parent marked "Not crying" (<see cref="IsConfirmedNotCrying"/>), an unanswered automatic one included. Same rule
    /// as the web's <c>countsAsCrying</c> (code/web/src/events/cryDetection.ts).
    /// </summary>
    public bool CountsAsCrying => Confirmed != false;

    /// <summary>
    /// Whether a fussy spell's payload carries the parent's "Not crying" answer (<c>cry_confirmed</c> is <c>false</c>,
    /// docs/design/31-cry-detector-spike.md section 13, CD5). Such a spell stays a record (timeline, events list,
    /// backup) but every server reader that counts crying leaves it out.
    /// </summary>
    public static bool IsConfirmedNotCrying(EventPayload payload) => !Read(payload).CountsAsCrying;

    public static CryDetection Read(EventPayload payload)
    {
        using var document = JsonDocument.Parse(payload.Value);
        var root = document.RootElement;
        return root.ValueKind != JsonValueKind.Object
            ? None
            : new CryDetection(Boolean(root, AutoDetectedMember) == true, Boolean(root, ConfirmedMember));
    }

    private static bool? Boolean(JsonElement root, string key) =>
        root.TryGetProperty(key, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean()
            : null;
}
