using System.Collections.Frozen;
using System.Text.Json;
using System.Text.Json.Nodes;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Units;
using ModelContextProtocol.Protocol;

namespace Lotties.Api.Assistants.Mcp;

/// <summary>
/// One MCP tool: its name, the scope it needs (<see cref="McpScopes"/>), its parameters (schema and validation) and the one
/// <see cref="IAssistantService"/> method it maps to. The adapter adds no logic of its own (docs/design/32-assistants.md).
/// </summary>
internal sealed record McpTool(
    string Name,
    string Title,
    string Description,
    string Scope,
    IReadOnlyList<McpParameter> Parameters,
    Func<IAssistantService, AssistantInvocation, McpArguments, CancellationToken, Task<AssistantResult>> Run,
    Func<McpArguments, McpArgumentError?>? Check = null)
{
    public bool Writes => Scope == McpScopes.Write;

    /// <summary>The tool as <c>tools/list</c> shows it: a strict object schema (no other members) and the behaviour hints.</summary>
    public Tool Definition() => new()
    {
        Name = Name,
        Title = Title,
        Description = Description,
        InputSchema = JsonSerializer.SerializeToElement(InputSchema()),
        Annotations = new ToolAnnotations
        {
            Title = Title,
            ReadOnlyHint = !Writes,
            DestructiveHint = false,
            IdempotentHint = true,
            OpenWorldHint = false,
        },
    };

    private JsonObject InputSchema()
    {
        var properties = new JsonObject();
        foreach (var parameter in Parameters)
        {
            properties[parameter.Name] = parameter.Schema();
        }

        var schema = new JsonObject { ["type"] = "object", ["properties"] = properties, ["additionalProperties"] = false };
        var required = Parameters.Where(parameter => parameter.Required).Select(parameter => (JsonNode)JsonValue.Create(parameter.Name)).ToArray();
        if (required.Length > 0)
        {
            schema["required"] = new JsonArray(required);
        }

        return schema;
    }
}

/// <summary>
/// The tools of the MCP server (docs/design/32-assistants.md section 9). Reads need <see cref="McpScopes.Read"/>, logging
/// needs <see cref="McpScopes.Write"/>. No medication tool, no dose, no free text: nothing a model says is stored as text.
/// </summary>
internal static class McpToolCatalog
{
    private const string Facts = " Facts from the parents' own Lotties log, not medical advice.";
    private const string Retry = " Pass a new idempotencyKey for each action and the same key when retrying it, so it is logged once.";

    private static readonly McpParameter Amount = new(
        "amountMl",
        McpParameterKind.Integer,
        "The bottle's amount in ml (all of it drunk). Give this, or amount with unit, not both.",
        Min: AssistantLimits.BottleMinMl,
        Max: AssistantLimits.BottleMaxMl);

    private static readonly McpParameter AmountIn = new(
        "amount",
        McpParameterKind.Number,
        "The bottle's amount in the given unit (decimals allowed, e.g. 4.5 with unit oz); it is converted to whole ml (1 to 500 ml after conversion). Instead of amountMl.",
        Max: 100_000);

    private static readonly McpParameter AmountUnit = new(
        "unit",
        McpParameterKind.Choice,
        "The unit of amount: ml (milliliters) or oz (US fluid ounces). Default ml. Only with amount.",
        Values: ["ml", "oz"]);

    private static readonly McpParameter BottleContent = new("kind", McpParameterKind.Choice, "What the bottle held: formula or breast_milk. Omit when unknown.", Values: ["formula", "breast_milk"]);
    private static readonly McpParameter NursingSide = new("side", McpParameterKind.Choice, "The breast: left or right. Omit to use the side opposite to where the last feed ended.", Values: ["left", "right"]);
    private static readonly McpParameter DiaperContent = new("kind", McpParameterKind.Choice, "The diaper: wet, dirty or both.", Required: true, Values: ["wet", "dirty", "both"]);
    private static readonly McpParameter Day = new("date", McpParameterKind.Date, "The local day, YYYY-MM-DD (today by default; up to a year back).");
    private static readonly McpParameter EndDay = new("endDate", McpParameterKind.Date, "The last local day of the week, YYYY-MM-DD (today by default; up to a year back).");

    public static IReadOnlyList<McpTool> All { get; } =
    [
        Read(
            "list_babies",
            "List babies",
            "Lists the babies the signed-in user can ask about: id, the name only when the user turned on \"say my baby's name\" in the Lotties app (otherwise no name is returned), the user's role (owner, parent, caregiver, viewer), whether the user can log events for the baby, and which one the other tools use when no babyId is given. Use an id as babyId in the other tools.",
            [],
            (assistant, invocation, _, token) => assistant.ListBabiesAsync(invocation, token)),
        Read(
            "get_baby_profile",
            "Baby profile",
            "The baby's age (whole days, weeks and months); the name only when the user turned on \"say my baby's name\" in the Lotties app.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadBabyProfileAsync(invocation, token)),
        Read(
            "get_last_feed",
            "Last feed",
            "The newest feeding of the last 30 days: when it started (UTC), whether it is still running, its method (breast, bottle, solid), the bottle amount and kind, the breast side.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadLastFeedAsync(invocation, token)),
        Read(
            "get_sleep_status",
            "Sleep status",
            "Whether the baby is sleeping now (since when, minutes so far) or awake (since when, and how long the last sleep lasted), from the last 30 days.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadSleepStatusAsync(invocation, token)),
        Read(
            "get_diapers_today",
            "Diapers today",
            "Diaper changes since local midnight (the last 24 hours when the family's time zone is unknown): count, wet and dirty (a mixed diaper counts in both).",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadDiapersTodayAsync(invocation, token)),
        Read(
            "get_next_appointment",
            "Next appointment",
            "The next upcoming appointment within a year: when it starts (UTC), and the family's own title and type.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadNextAppointmentAsync(invocation, token)),
        Read(
            "get_due_vaccines",
            "Vaccines due",
            "Vaccine doses due or overdue today by the published vaccination schedule Lotties ships, compared with the doses the family recorded (up to five, with names in English and Portuguese). Schedule facts only: the baby's health professional decides.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadDueVaccinesAsync(invocation, token)),
        Read(
            "get_day_summary",
            "Day summary",
            "One local day: sleep minutes (total, night, naps, longest), the number of naps, feeds (count, by method, bottle ml logged) and diapers (total, wet, dirty), computed with the same rules as the app's Insights. complete is false for today.",
            [McpParameter.BabyId, Day],
            (assistant, invocation, arguments, token) => assistant.ReadDaySummaryAsync(invocation, arguments.Date(Day.Name), token)),
        Read(
            "get_week_summary",
            "Week summary",
            "The seven local days ending on endDate, oldest first, each as get_day_summary returns it.",
            [McpParameter.BabyId, EndDay],
            (assistant, invocation, arguments, token) => assistant.ReadWeekSummaryAsync(invocation, arguments.Date(EndDay.Name), token)),
        Read(
            "get_next_nap_window",
            "Next nap window",
            "When the sleep prediction expects the next nap: the window (earliest, expected, latest, UTC) when the baby is awake and there is enough sleep history (the Now screen's rules, stale predictions left out); when the baby sleeps, since when and the expected wake-up if the prediction has one; otherwise no_nap_prediction.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadNextNapWindowAsync(invocation, token)),
        Read(
            "get_next_feed",
            "Next feed",
            "When the feeding prediction expects the next feed (earliest, expected, latest, UTC), or no_next_feed when there is not enough feed history.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadNextFeedAsync(invocation, token)),
        Read(
            "get_next_diaper",
            "Next diaper change",
            "When the diaper predictions expect the next wet diaper and the next dirty diaper (wetEstimate, dirtyEstimate: earliest, expected, latest, UTC), each only when there is enough history; no_next_diaper when neither.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadNextDiaperAsync(invocation, token)),
        Read(
            "get_diapers_average",
            "Diapers per day",
            "The average diapers per day over the complete local days of the last seven (today left out) that have diapers, to one decimal, with the wet and dirty split (a mixed diaper counts in both); at least three such days, else no_diapers_average.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadDiapersAverageAsync(invocation, token)),
        Read(
            "get_bottle_average",
            "Recent bottle sizes",
            "Facts from the baby's own log, not a recommendation: the average and the last of her last five bottles with an amount (ml), when there are at least three in the last 14 days; otherwise no_bottle_data.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadBottleAverageAsync(invocation, token)),
        Read(
            "get_sleep_today",
            "Sleep today",
            "Total sleep since local midnight (naps and night, a running sleep counted until now) in minutes, and the number of naps.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadSleepTodayAsync(invocation, token)),
        Read(
            "get_bottle_today",
            "Bottles today",
            "The bottles since local midnight (the last 24 hours when the family's time zone is unknown): the number of bottles, the total ml drunk (the drunk amount, else the prepared amount, as the app counts it) and, when the log says what the bottles held, the formula and breast milk bottles with their ml.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadBottleTodayAsync(invocation, token)),
        Read(
            "get_feeds_today",
            "Feeds today",
            "The feeds since local midnight (the last 24 hours when the family's time zone is unknown): the total and how many were bottles, breast (nursing) and solid food.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadFeedsTodayAsync(invocation, token)),
        Read(
            "get_last_diaper",
            "Last diaper",
            "The newest diaper of the last 30 days: when (UTC) and its content (wet, dirty, both), or no_diapers.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadLastDiaperAsync(invocation, token)),
        Read(
            "get_cry_reasons",
            "Why is she crying",
            "What the baby's own log suggests about a crying spell: up to three likely causes (hunger, sleepy, diaper, gas), each with its level and the logged facts behind it, ranked by the same rules as the app's \"Why is she crying?\" sheet, plus the red flags (fever, inconsolable crying, refusing feeds, unusual sleepiness, a bulging or stiff soft spot) for which the parents should call the pediatrician or emergency services. It is not a diagnosis or medical advice: always tell the user the red flags, and give no remedies, soothing steps or doses.",
            [McpParameter.BabyId],
            (assistant, invocation, _, token) => assistant.ReadCryReasonsAsync(invocation, token)),
        Write(
            "request_delete_last_entry",
            "Ask to delete the last entry",
            "Asks for the last entry this assistant logged in the last 30 minutes to be deleted: it only marks the entry (nothing is deleted); the person approves the deletion or keeps the entry in the Lotties app. Assistants can never delete. Answers delete_requested, last_not_undoable when the newest entry it made is the wake-up marker (nothing changes, no older entry is chosen), or no_entry_to_delete when it made no entry in that time.",
            [],
            (assistant, invocation, _, token) => assistant.RequestDeleteLastAsync(invocation, token)),
        Write(
            "log_sleep_start",
            "Log sleep start",
            "Starts a sleep timer now (nap or night by the app's rule). When a sleep already runs it answers sleep_already_running and changes nothing.",
            [],
            (assistant, invocation, _, token) => assistant.LogSleepStartAsync(invocation, token)),
        Write(
            "log_sleep_end",
            "Log wake-up",
            "Ends the running sleep now and logs the wake-up, like the app's Wake-up button. Changes nothing when no sleep, or more than one, is running.",
            [],
            (assistant, invocation, _, token) => assistant.LogSleepEndAsync(invocation, token)),
        Write(
            "log_bottle",
            "Log bottle",
            "Logs a bottle given now. A formula bottle names the baby's current formula when one is set in the app.",
            [Amount, AmountIn, AmountUnit, BottleContent],
            (assistant, invocation, arguments, token) => arguments.Decimal(AmountIn.Name) is { } amount
                ? assistant.LogBottleVolumeAsync(invocation, amount, arguments.Text(AmountUnit.Name) == "oz" ? VolumeUnit.FluidOunces : VolumeUnit.Milliliters, BottleKindOf(arguments.Text(BottleContent.Name)), token)
                : assistant.LogBottleAsync(invocation, arguments.Integer(Amount.Name), BottleKindOf(arguments.Text(BottleContent.Name)), token),
            BottleAmountCheck),
        Write(
            "log_nursing",
            "Log nursing",
            "Starts a nursing timer now (stop it in the app). When one already runs it answers nursing_already_running and changes nothing.",
            [NursingSide],
            (assistant, invocation, arguments, token) => assistant.LogNursingAsync(invocation, SideOf(arguments.Text(NursingSide.Name)), token)),
        Write(
            "log_diaper",
            "Log diaper",
            "Logs a diaper changed now.",
            [DiaperContent],
            (assistant, invocation, arguments, token) => assistant.LogDiaperAsync(invocation, DiaperOf(arguments.Text(DiaperContent.Name)), token)),
    ];

    private static readonly FrozenDictionary<string, McpTool> ByName = All.ToFrozenDictionary(tool => tool.Name, StringComparer.Ordinal);

    public static McpTool? Find(string? name) => name is not null && ByName.TryGetValue(name, out var tool) ? tool : null;

    /// <summary>The tools <paramref name="scopes"/> open, in catalog order.</summary>
    public static IReadOnlyList<McpTool> AllowedBy(IReadOnlySet<string> scopes) => All.Where(tool => scopes.Contains(tool.Scope)).ToArray();

    private static McpTool Read(string name, string title, string description, McpParameter[] parameters, Func<IAssistantService, AssistantInvocation, McpArguments, CancellationToken, Task<AssistantResult>> run) =>
        new(name, title, description + Facts, McpScopes.Read, parameters.Length == 0 ? parameters : [.. parameters, McpParameter.TimeZone], run);

    private static McpTool Write(string name, string title, string description, McpParameter[] parameters, Func<IAssistantService, AssistantInvocation, McpArguments, CancellationToken, Task<AssistantResult>> run, Func<McpArguments, McpArgumentError?>? check = null) =>
        new(name, title, description + Retry + Facts, McpScopes.Write, [McpParameter.BabyId, .. parameters, McpParameter.IdempotencyKey, McpParameter.TimeZone], run, check);

    /// <summary>Exactly one of <c>amountMl</c> and <c>amount</c>; <c>unit</c> only with <c>amount</c>.</summary>
    private static McpArgumentError? BottleAmountCheck(McpArguments arguments)
    {
        var hasMl = arguments.Integer(Amount.Name) is not null;
        var hasAmount = arguments.Decimal(AmountIn.Name) is not null;
        if (hasMl == hasAmount)
        {
            return new McpArgumentError(Amount.Name, hasMl ? "Give amountMl or amount, not both." : "amountMl is required (or amount with an optional unit).");
        }

        return arguments.Text(AmountUnit.Name) is not null && !hasAmount
            ? new McpArgumentError(AmountUnit.Name, "unit goes with amount; amountMl is always in ml.")
            : null;
    }

    private static BottleKind BottleKindOf(string? kind) => kind switch
    {
        "formula" => BottleKind.Formula,
        "breast_milk" => BottleKind.BreastMilk,
        _ => BottleKind.Unspecified,
    };

    private static BreastSide? SideOf(string? side) => side switch
    {
        "left" => BreastSide.Left,
        "right" => BreastSide.Right,
        _ => null,
    };

    private static DiaperKind DiaperOf(string? kind) => kind switch
    {
        "dirty" => DiaperKind.Dirty,
        "both" => DiaperKind.Both,
        _ => DiaperKind.Wet,
    };
}
