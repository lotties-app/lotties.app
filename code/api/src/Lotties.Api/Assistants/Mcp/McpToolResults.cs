using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Lotties.Application.Assistants;
using ModelContextProtocol.Protocol;

namespace Lotties.Api.Assistants.Mcp;

/// <summary>
/// Renders tool outcomes for MCP clients: <c>structuredContent</c> is the language-neutral <see cref="AssistantResult"/> as
/// JSON (camelCase, codes and enums snake_case, instants UTC, empty and null members left out), and <c>content</c> holds a
/// short plain-English sentence plus the same JSON as text (for clients that read only text). Refusals are tool errors
/// (<c>isError: true</c>) carrying their code; nothing internal (no stack trace, no exception text) is ever returned.
/// </summary>
internal static class McpToolResults
{
    /// <summary>The codes that mean the command did not run: returned with <c>isError: true</c>.</summary>
    private static readonly HashSet<AssistantResultCode> Refusals =
    [
        AssistantResultCode.NotAllowed,
        AssistantResultCode.NoBaby,
        AssistantResultCode.ChooseBaby,
        AssistantResultCode.RateLimited,
        AssistantResultCode.InvalidAmount,
        AssistantResultCode.UnknownBaby,
        AssistantResultCode.InvalidDate,
    ];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public const string InvalidArguments = "invalid_arguments";
    public const string InsufficientScope = "insufficient_scope";
    public const string Rejected = "rejected";
    public const string InternalError = "internal_error";

    public static bool IsRefusal(AssistantResultCode code) => Refusals.Contains(code);

    /// <summary>The tool result of a command's <paramref name="result"/>.</summary>
    public static CallToolResult From(AssistantResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        var structured = JsonSerializer.SerializeToNode(result, Json)!.AsObject();
        foreach (var empty in structured.Where(member => member.Value is JsonArray { Count: 0 }).Select(member => member.Key).ToArray())
        {
            structured.Remove(empty);
        }

        return Build(McpResultText.Of(result), structured, IsRefusal(result.Code));
    }

    /// <summary>A tool error of the adapter's own (<see cref="InvalidArguments"/>, <see cref="InsufficientScope"/>, ...).</summary>
    public static CallToolResult Error(string code, string message, string? field = null)
    {
        var structured = new JsonObject { ["code"] = code, ["message"] = message };
        if (field is not null)
        {
            structured["field"] = field;
        }

        return Build($"{code}: {message}", structured, isError: true);
    }

    private static CallToolResult Build(string sentence, JsonObject structured, bool isError)
    {
        var text = structured.ToJsonString(Json);
        return new CallToolResult
        {
            Content = [new TextContentBlock { Text = sentence }, new TextContentBlock { Text = text }],
            StructuredContent = JsonSerializer.SerializeToElement(structured, Json),
            IsError = isError,
        };
    }
}

/// <summary>One short English sentence per result code (the JSON carries the facts; this is for clients that show text).</summary>
internal static class McpResultText
{
    public static string Of(AssistantResult result)
    {
        var baby = result.Baby?.Name ?? "the baby";
        return result.Code switch
        {
            AssistantResultCode.NotAllowed => result.Baby is null
                ? "not_allowed: this account is not a family member of any baby in Lotties (a doctor's patients are not available here)."
                : $"not_allowed: the user's role on {baby} does not allow this.",
            AssistantResultCode.NoBaby => "no_baby: there is no baby in this Lotties account yet.",
            AssistantResultCode.ChooseBaby => "choose_baby: the user has several babies; call list_babies and pass babyId.",
            AssistantResultCode.UnknownBaby => "unknown_baby: that babyId is not one of the user's babies; call list_babies.",
            AssistantResultCode.RateLimited => "rate_limited: too many requests; try again in a minute.",
            AssistantResultCode.InvalidAmount => $"invalid_amount: the amount must be from {result.Min} to {result.Max} ml.",
            AssistantResultCode.InvalidDate => $"invalid_date: the date must be from {result.EarliestDate:yyyy-MM-dd} to {result.LatestDate:yyyy-MM-dd}{DaysIn(result)}.",
            AssistantResultCode.SleepStarted => $"Sleep started for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.SleepAlreadyRunning => $"{baby} is already sleeping, since {Time(result, result.At)}; nothing was logged.",
            AssistantResultCode.SleepEnded => $"{baby} woke up at {Time(result, result.At)}{Minutes(", after ", result.Minutes, " minutes of sleep")}.",
            AssistantResultCode.NoRunningSleep => $"{baby} is not sleeping; nothing was changed.",
            AssistantResultCode.SeveralRunningSleeps => $"{baby} has {result.Count} sleep timers running; nothing was changed (stop them in the app).",
            AssistantResultCode.BottleLogged => $"Logged a {result.AmountMl} ml bottle for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.NursingStarted => $"Nursing started for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.NursingAlreadyRunning => $"{baby} is already nursing, since {Time(result, result.At)}; nothing was logged.",
            AssistantResultCode.DiaperLogged => $"Logged a diaper for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.LastFeed => $"{baby}'s last feed started at {Time(result, result.At)}{(result.Running == true ? " and is still running" : string.Empty)}.",
            AssistantResultCode.NoFeeds => $"No feed of {baby} in the last 30 days.",
            AssistantResultCode.Sleeping => $"{baby} has been sleeping since {Time(result, result.At)}{Minutes(" (", result.Minutes, " minutes)")}.",
            AssistantResultCode.Awake => $"{baby} has been awake since {Time(result, result.At)}{Minutes("; the last sleep lasted ", result.Minutes, " minutes")}.",
            AssistantResultCode.NoSleeps => $"No sleep of {baby} in the last 30 days.",
            AssistantResultCode.DiapersToday => $"{baby} has had {result.Count} diapers ({result.Wet} wet, {result.Dirty} dirty) {(result.Window == AssistantDayWindow.Today ? "today" : "in the last 24 hours")}.",
            AssistantResultCode.NextAppointment => $"{baby}'s next appointment starts at {Time(result, result.Appointment?.StartsAt)}.",
            AssistantResultCode.NoAppointment => $"{baby} has no upcoming appointment.",
            AssistantResultCode.VaccinesDue => $"{result.Count} vaccine doses are due or overdue for {baby} by the schedule ({result.Overdue} overdue).",
            AssistantResultCode.NoVaccinesDue => $"No vaccine dose is due for {baby} by the schedule.",
            AssistantResultCode.Babies => $"{result.Babies.Count} babies.",
            AssistantResultCode.BabyProfile => $"{baby} is {result.Age?.Days} days old.",
            AssistantResultCode.DaySummary => $"Summary of {baby}'s day {result.Days.FirstOrDefault()?.Date:yyyy-MM-dd}{DaysIn(result)}.",
            AssistantResultCode.WeekSummary => $"Summary of {baby}'s 7 days up to {result.Days.LastOrDefault()?.Date:yyyy-MM-dd}{DaysIn(result)}.",
            _ => AssistantResult.CodeName(result.Code),
        };
    }

    /// <summary>The local time in the family's zone, else UTC (<c>2026-10-23 14:05 America/Sao_Paulo</c>).</summary>
    private static string Time(AssistantResult result, DateTimeOffset? instant)
    {
        if (instant is not { } value)
        {
            return "an unknown time";
        }

        return result.TimeZone is { } zoneId && TimeZoneInfo.TryFindSystemTimeZoneById(zoneId, out var zone)
            ? $"{TimeZoneInfo.ConvertTime(value, zone).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)} {zoneId}"
            : $"{value.UtcDateTime.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)} UTC";
    }

    /// <summary>" (days in America/Sao_Paulo)", or the UTC notice when no zone is known: never silently UTC.</summary>
    private static string DaysIn(AssistantResult result) => result.TimeZoneSource == Domain.Assistants.AssistantZoneSource.Utc
        ? " (days in UTC: no time zone is set for this family; pass timeZone to use local days)"
        : $" (days in {result.TimeZone})";

    private static string Minutes(string before, int? minutes, string after) =>
        minutes is { } value ? $"{before}{value.ToString(CultureInfo.InvariantCulture)}{after}" : string.Empty;
}
