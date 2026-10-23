using System.Text.Json;
using Lotties.Domain.Events;
using Lotties.Domain.Formulas;

namespace Lotties.Domain.Clinical;

/// <summary>
/// Reads the observations the summaries need from stored events. Payloads are read leniently, like the parents' app does:
/// a member that is absent, <c>null</c>, of the wrong JSON kind or out of range reads as no value.
/// </summary>
public static class ClinicalObservations
{
    private const string MethodMember = "method";
    private const string AmountMlMember = "amount_ml";
    private const string BottleFeedingTypeMember = "bottle_feeding_type";
    private const string ContentMember = "content";

    public static SleepObservation Sleep(Event stored)
    {
        ArgumentNullException.ThrowIfNull(stored);
        var facts = EventPayloadFacts.Read(stored.Payload);
        return new SleepObservation(stored.StartedAt, stored.EndedAt, facts.Kind, facts.PausedSeconds, facts.PausedAt);
    }

    public static FeedObservation Feed(Event stored)
    {
        ArgumentNullException.ThrowIfNull(stored);
        using var document = JsonDocument.Parse(stored.Payload.Value);
        var root = document.RootElement;
        return new FeedObservation(
            stored.StartedAt,
            Text(root, MethodMember),
            Number(root, AmountMlMember),
            Text(root, BottleFeedingTypeMember),
            GuidMember(root, FormulaPayload.FormulaIdMember),
            Text(root, FormulaPayload.FormulaNameMember));
    }

    public static DiaperObservation Diaper(Event stored)
    {
        ArgumentNullException.ThrowIfNull(stored);
        using var document = JsonDocument.Parse(stored.Payload.Value);
        return new DiaperObservation(stored.StartedAt, Text(document.RootElement, ContentMember));
    }

    private static string? Text(JsonElement root, string member) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty(member, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static double? Number(JsonElement root, string member) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty(member, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number)
            ? number
            : null;

    private static Guid? GuidMember(JsonElement root, string member) =>
        Guid.TryParse(Text(root, member), out var id) && id != Guid.Empty ? id : null;
}
