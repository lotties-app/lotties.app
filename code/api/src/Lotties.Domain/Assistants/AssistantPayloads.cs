using System.Globalization;
using System.Text.Json.Nodes;
using Lotties.Domain.Events;
using Lotties.Domain.Formulas;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Assistants;

/// <summary>
/// The payloads assistant commands write, the same members the web app writes for the same action (built-in types of
/// <see cref="EventTypes.BuiltInEventTypes"/>): a sleep timer's <c>kind</c>, a bottle's <c>method</c>, <c>amount_ml</c>,
/// <c>bottle_feeding_type</c> and current formula, a nursing session's <c>method</c>, <c>side</c> and <c>side_since</c>,
/// a diaper's <c>content</c>, and a stopped timer's folded pause. They are then checked by the normal event rules.
/// </summary>
public static class AssistantPayloads
{
    /// <summary>The nursing payload key of the open side's start (web <c>SIDE_SINCE_KEY</c>, not a declared field).</summary>
    public const string SideSinceMember = "side_since";

    /// <summary>The nursing payload key of the side the last feed ended on (web <c>LAST_SIDE_KEY</c>, set on stop).</summary>
    public const string LastSideMember = "last_side";

    public static EventPayload SleepTimer(string kind) => Of(new JsonObject { ["kind"] = kind });

    /// <summary>
    /// A bottle of <paramref name="amountMl"/> prepared (all of it drunk: no <c>amount_drunk_ml</c>). A bottle of formula
    /// names <paramref name="currentFormula"/> when the baby has one (the Feed tray rule), else only its kind.
    /// </summary>
    public static EventPayload Bottle(int amountMl, BottleKind kind, Formula? currentFormula)
    {
        var payload = new JsonObject { ["method"] = "bottle", [BottleAmounts.PreparedMember] = amountMl };
        AddBottleKind(payload, kind, currentFormula);
        return Of(payload);
    }

    public static EventPayload Nursing(BreastSide side, DateTimeOffset startedAt) => Of(new JsonObject
    {
        ["method"] = "breast",
        ["side"] = SideCode(side),
        [SideSinceMember] = Iso(startedAt),
    });

    public static EventPayload Diaper(DiaperKind kind) => Of(new JsonObject { ["content"] = ContentCode(kind) });

    /// <summary>
    /// <paramref name="payload"/> of a timer stopped at <paramref name="endedAt"/>: an open pause (<c>paused_at</c>) is
    /// folded into <c>paused_seconds</c> (never beyond the timer's length) and removed, as the web's finish does; every other
    /// member is kept.
    /// </summary>
    public static EventPayload Stopped(EventPayload payload, DateTimeOffset startedAt, DateTimeOffset endedAt)
    {
        var facts = EventPayloadFacts.Read(payload);
        if (facts.PausedAt is not { } pausedAt)
        {
            return payload;
        }

        var root = JsonNode.Parse(payload.Value)!.AsObject();
        root.Remove(PauseFields.PausedAt);
        root[PauseFields.PausedSeconds] = FoldedPause(facts.PausedSeconds, pausedAt, startedAt, endedAt);
        return Of(root);
    }

    public static string SideCode(BreastSide side) => side == BreastSide.Right ? "right" : "left";

    public static string ContentCode(DiaperKind kind) => kind switch
    {
        DiaperKind.Dirty => DiaperContents.Dirty,
        DiaperKind.Both => DiaperContents.Mixed,
        _ => DiaperContents.Wet,
    };

    private static void AddBottleKind(JsonObject payload, BottleKind kind, Formula? currentFormula)
    {
        if (kind == BottleKind.BreastMilk)
        {
            payload["bottle_feeding_type"] = "breast_milk";
            return;
        }

        if (kind != BottleKind.Formula)
        {
            return;
        }

        payload["bottle_feeding_type"] = "formula";
        if (currentFormula is { IsCurrent: true, IsArchived: false })
        {
            payload[FormulaPayload.FormulaIdMember] = currentFormula.Id.ToString("D");
            payload[FormulaPayload.FormulaNameMember] = currentFormula.Name;
        }
    }

    private static int FoldedPause(int pausedSeconds, DateTimeOffset pausedAt, DateTimeOffset startedAt, DateTimeOffset endedAt)
    {
        var open = Math.Max(0, (long)(endedAt - (pausedAt < startedAt ? startedAt : pausedAt)).TotalSeconds);
        var length = Math.Max(0, (long)(endedAt - startedAt).TotalSeconds);
        return (int)Math.Min(Math.Min(pausedSeconds + open, length), PauseFields.MaxPausedSeconds);
    }

    private static string Iso(DateTimeOffset instant) => instant.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static EventPayload Of(JsonObject payload) => EventPayload.From(payload.ToJsonString());
}
