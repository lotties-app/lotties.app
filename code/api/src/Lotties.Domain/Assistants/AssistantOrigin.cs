using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Lotties.Domain.Events;

namespace Lotties.Domain.Assistants;

/// <summary>
/// The origin marker (docs/design/32-assistants.md "Origin marker"): every event an assistant command creates carries the
/// payload member <c>via</c>, the adapter's lowercase name (<c>alexa</c>, <c>mcp</c>), so the family can tell a voice or AI
/// command from an app command (the command still runs as the linked parent). An event the command only changes, one the app
/// or another adapter created (a stopped sleep timer), keeps its own <c>via</c> and gets <c>updated_via</c>; an adapter
/// stopping its own timer changes nothing. No table, no declared field (members no field declares are not checked, like the
/// cry monitor's markers); the value is only the adapter name: never text, an id, a token or anything the user said.
/// </summary>
public static partial class AssistantOrigin
{
    public const string ViaMember = "via";
    public const string UpdatedViaMember = "updated_via";

    /// <summary>The adapter that asked for the entry to be deleted; the person approves or keeps it in the app (docs/design/32-assistants.md "Assistants never delete").</summary>
    public const string DeleteRequestedViaMember = "delete_requested_via";

    /// <summary>When the deletion was asked for (ISO instant, the server clock).</summary>
    public const string DeleteRequestedAtMember = "delete_requested_at";

    /// <summary><paramref name="payload"/> with <c>via</c> set to <paramref name="adapter"/> (unchanged for an adapter name that is not a plain lowercase word).</summary>
    public static EventPayload Created(EventPayload payload, string adapter) => With(payload, ViaMember, adapter, replace: true);

    /// <summary>
    /// <paramref name="payload"/> of an event <paramref name="adapter"/> changed: the original <c>via</c> stays; unless that is
    /// this adapter's own, <c>updated_via</c> becomes the adapter.
    /// </summary>
    public static EventPayload Changed(EventPayload payload, string adapter)
    {
        var name = Normalize(adapter);
        return name is null || ViaOf(payload) == name ? payload : With(payload, UpdatedViaMember, name, replace: true);
    }

    /// <summary>
    /// <paramref name="payload"/> marked as a deletion request from <paramref name="adapter"/> at <paramref name="at"/>; unchanged when a
    /// request is already open (asking twice changes nothing). Nothing is deleted: the person decides in the app.
    /// </summary>
    public static EventPayload DeleteRequested(EventPayload payload, string adapter, DateTimeOffset at)
    {
        if (DeleteRequestedViaOf(payload) is not null || Normalize(adapter) is not { } name)
        {
            return payload;
        }

        var root = JsonNode.Parse(payload.Value) is JsonObject existing ? existing : new JsonObject();
        root[DeleteRequestedViaMember] = name;
        root[DeleteRequestedAtMember] = at.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
        return EventPayload.From(root.ToJsonString());
    }

    public static string? DeleteRequestedViaOf(EventPayload payload) => Text(payload, DeleteRequestedViaMember);

    public static string? ViaOf(EventPayload payload) => Text(payload, ViaMember);

    public static string? UpdatedViaOf(EventPayload payload) => Text(payload, UpdatedViaMember);

    private static EventPayload With(EventPayload payload, string member, string adapter, bool replace)
    {
        var name = Normalize(adapter);
        if (name is null)
        {
            return payload;
        }

        var root = JsonNode.Parse(payload.Value) is JsonObject existing ? existing : new JsonObject();
        if (replace || !root.ContainsKey(member))
        {
            root[member] = name;
        }

        return EventPayload.From(root.ToJsonString());
    }

    private static string? Normalize(string? adapter)
    {
        var name = adapter?.Trim().ToLowerInvariant();
        return name is not null && AdapterName().IsMatch(name) ? name : null;
    }

    private static string? Text(EventPayload payload, string member)
    {
        using var document = JsonDocument.Parse(payload.Value);
        return document.RootElement.ValueKind == JsonValueKind.Object
            && document.RootElement.TryGetProperty(member, out var value)
            && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
    }

    [GeneratedRegex("^[a-z0-9_-]{1,32}$")]
    private static partial Regex AdapterName();
}
