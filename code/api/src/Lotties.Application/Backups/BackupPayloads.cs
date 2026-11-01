using System.Text.Json;
using System.Text.Json.Nodes;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;
using Lotties.Domain.Prescriptions;

namespace Lotties.Application.Backups;

/// <summary>
/// Moves the references inside an event payload to the ids the records have in the target baby: the medication and
/// prescription of each entry of a medication event, and the formula of a bottle. Other members are untouched, and a
/// member that is not a GUID string is left as it is, so the normal payload checks report it.
/// </summary>
internal static class BackupPayloads
{
    /// <summary>The payload text of <paramref name="payload"/> (<c>{}</c> when absent) with its references mapped by <paramref name="map"/> (kind, source id) to the target id.</summary>
    public static string Remap(JsonElement? payload, Guid typeId, Func<string, Guid, Guid> map)
    {
        ArgumentNullException.ThrowIfNull(map);
        if (payload is not { ValueKind: JsonValueKind.Object } element)
        {
            return payload is null or { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined } ? "{}" : payload.Value.GetRawText();
        }

        if (typeId != BuiltInEventTypes.MedicationId && typeId != BuiltInEventTypes.FeedingId)
        {
            return element.GetRawText();
        }

        var root = JsonNode.Parse(element.GetRawText()) as JsonObject ?? new JsonObject();
        if (typeId == BuiltInEventTypes.MedicationId)
        {
            RemapMedications(root, map);
        }
        else
        {
            RemapMember(root, FormulaPayload.FormulaIdMember, "formula", map);
        }

        return root.ToJsonString();
    }

    private static void RemapMedications(JsonObject root, Func<string, Guid, Guid> map)
    {
        if (root[MedicationDosePayload.MedicationsMember] is not JsonArray entries)
        {
            return;
        }

        foreach (var entry in entries.OfType<JsonObject>())
        {
            RemapMember(entry, MedicationDosePayload.MedicationIdMember, "medication", map);
            RemapMember(entry, MedicationDosePayload.PrescriptionIdMember, "prescription", map);
        }
    }

    private static void RemapMember(JsonObject owner, string member, string kind, Func<string, Guid, Guid> map)
    {
        if (owner[member] is JsonValue value && value.TryGetValue<string>(out var text) && Guid.TryParse(text, out var id) && id != Guid.Empty)
        {
            owner[member] = map(kind, id).ToString("D");
        }
    }
}
