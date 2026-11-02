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

    public static EventPayload Bath(decimal? temperatureC)
    {
        var payload = new JsonObject();
        if (temperatureC is not null)
        {
            payload["temperature_c"] = temperatureC;
        }

        return Of(payload);
    }

    public static EventPayload TummyTime() => Of(new JsonObject());

    public static EventPayload BellyPain(int intensity) => Of(new JsonObject { ["intensity"] = intensity });

    public static EventPayload BreastPump(int? amountLeftMl, int? amountRightMl)
    {
        var payload = new JsonObject();
        if (amountLeftMl is not null)
        {
            payload["amount_left_ml"] = amountLeftMl;
        }

        if (amountRightMl is not null)
        {
            payload["amount_right_ml"] = amountRightMl;
        }

        return Of(payload);
    }

    public static EventPayload NasalSuction(string? tool, bool? saline)
    {
        var payload = new JsonObject();
        if (tool is not null)
        {
            payload["tool"] = tool;
        }

        if (saline is not null)
        {
            payload["saline"] = saline;
        }

        return Of(payload);
    }

    public static EventPayload BellyMassage(string? reason, string? helped)
    {
        var payload = new JsonObject();
        if (reason is not null)
        {
            payload["reason"] = reason;
        }

        if (helped is not null)
        {
            payload["helped"] = helped;
        }

        return Of(payload);
    }

    public static EventPayload Fussy(string? intensity, string? whatHelped)
    {
        var payload = new JsonObject();
        if (intensity is not null)
        {
            payload["intensity"] = intensity;
        }

        if (whatHelped is not null)
        {
            payload["what_helped"] = whatHelped;
        }

        return Of(payload);
    }

    public static EventPayload NailTrim(string? where)
    {
        var payload = new JsonObject();
        if (where is not null)
        {
            payload["where"] = where;
        }

        return Of(payload);
    }

    public static EventPayload Temperature(decimal valueC, string? method)
    {
        var payload = new JsonObject { ["value_c"] = valueC };
        if (method is not null)
        {
            payload["method"] = method;
        }

        return Of(payload);
    }

    public static EventPayload SpitUp(string? kind, string? amount)
    {
        var payload = new JsonObject();
        if (kind is not null)
        {
            payload["kind"] = kind;
        }

        if (amount is not null)
        {
            payload["amount"] = amount;
        }

        return Of(payload);
    }

    public static EventPayload Teething(string? stage, string? tooth)
    {
        var payload = new JsonObject();
        if (stage is not null)
        {
            payload["stage"] = stage;
        }

        if (tooth is not null)
        {
            payload["tooth"] = tooth;
        }

        return Of(payload);
    }

    /// <summary>A milestone from the built-in list; voice never stores the "which milestone?" words (<c>custom</c>).</summary>
    public static EventPayload Milestone(string? milestone)
    {
        var payload = new JsonObject();
        if (milestone is not null)
        {
            payload["milestone"] = milestone;
        }

        return Of(payload);
    }

    public static EventPayload Symptom(string? symptom, string? severity)
    {
        var payload = new JsonObject();
        if (symptom is not null)
        {
            payload["symptom"] = symptom;
        }

        if (severity is not null)
        {
            payload["severity"] = severity;
        }

        return Of(payload);
    }

    public static EventPayload Outdoor(string? kind)
    {
        var payload = new JsonObject();
        if (kind is not null)
        {
            payload["kind"] = kind;
        }

        return Of(payload);
    }

    public static EventPayload SkinCare(string? product)
    {
        var payload = new JsonObject();
        if (product is not null)
        {
            payload["product"] = product;
        }

        return Of(payload);
    }

    public static EventPayload Medication(Guid medicationId, string medicationName, Guid prescriptionId, decimal? doseAmount, string? doseUnit)
    {
        var dose = new JsonObject();
        if (doseAmount is not null)
        {
            dose["amount"] = doseAmount;
        }

        if (doseUnit is not null)
        {
            dose["unit"] = doseUnit;
        }

        var entry = new JsonObject
        {
            ["medicationId"] = medicationId.ToString("D"),
            ["name"] = medicationName,
            ["dose"] = dose,
            ["prescriptionId"] = prescriptionId.ToString("D"),
        };

        return Of(new JsonObject { ["medications"] = new JsonArray(entry) });
    }

    /// <summary>
    /// <paramref name="payload"/> of a timer stopped at <paramref name="endedAt"/>: an open pause (<c>paused_at</c>) is
    /// folded into <c>paused_seconds</c> (never beyond the timer's length) and removed, as the web's finish does; a bottle
    /// drinking now closes its last timed stretch (<see cref="BottleHistory.ClosedAtStop"/>); every other member is kept.
    /// </summary>
    public static EventPayload Stopped(EventPayload payload, DateTimeOffset startedAt, DateTimeOffset endedAt)
    {
        var facts = EventPayloadFacts.Read(payload);
        if (facts.PausedAt is not { } pausedAt)
        {
            // A bottle drinking now closes its last stretch, so its history (design 44) says it was not paused at the end.
            return BottleHistory.ClosedAtStop(payload, startedAt, endedAt);
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
