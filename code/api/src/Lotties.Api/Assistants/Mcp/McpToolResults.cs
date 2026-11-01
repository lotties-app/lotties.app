using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Units;
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
        AssistantResultCode.ConsentRequired,
        AssistantResultCode.ChooseBaby,
        AssistantResultCode.RateLimited,
        AssistantResultCode.InvalidAmount,
        AssistantResultCode.InvalidValue,
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
    public static CallToolResult From(AssistantResult result, string? speech = null)
    {
        ArgumentNullException.ThrowIfNull(result);
        var structured = JsonSerializer.SerializeToNode(result, Json)!.AsObject();
        foreach (var empty in structured.Where(member => member.Value is JsonArray { Count: 0 }).Select(member => member.Key).ToArray())
        {
            structured.Remove(empty);
        }

        if (speech is not null)
        {
            structured["speech"] = speech;
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
        var name = SpokenBaby.NameOf(result);
        var baby = name ?? "the baby";
        var subject = name ?? "The baby";
        return result.Code switch
        {
            AssistantResultCode.NotAllowed => result.Baby is null
                ? "not_allowed: this account is not a family member of any baby in Lotties (a doctor's patients are not available here)."
                : $"not_allowed: the user's role on {baby} does not allow this.",
            AssistantResultCode.NoBaby => "no_baby: there is no baby in this Lotties account yet.",
            AssistantResultCode.ConsentRequired => "consent_required: the user must open the Lotties app and accept the terms of use and the privacy policy before assistants can use her data.",
            AssistantResultCode.ChooseBaby => "choose_baby: the user has several babies; call list_babies and pass babyId.",
            AssistantResultCode.UnknownBaby => "unknown_baby: that babyId is not one of the user's babies; call list_babies.",
            AssistantResultCode.RateLimited => "rate_limited: too many requests; try again in a minute.",
            AssistantResultCode.InvalidAmount => $"invalid_amount: the amount must be from {result.Min} to {result.Max} ml{(result.Units == UnitSystem.Us ? $" (up to {Volume(result.Max, result.Units)})" : string.Empty)}.",
            AssistantResultCode.InvalidValue => $"invalid_value: {result.Field} must be from {result.Min} to {result.Max}{(result.Field is "temperature" or "water_temperature" ? " degrees Celsius" : result.Field == "pump_amount" ? " ml" : string.Empty)}; nothing was logged.",
            AssistantResultCode.BathLogged => $"Logged a bath for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.TummyTimeStarted => $"Tummy time started for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.BellyPainLogged => $"Logged belly pain for {baby} at {Time(result, result.At)}, level {result.Intensity}.",
            AssistantResultCode.BreastPumpStarted => $"Breast pump session started for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.NasalSuctionLogged => $"Logged nasal suction for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.BellyMassageStarted => $"Belly massage started for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.FussyStarted => $"Fussy timer started for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.NailTrimLogged => $"Logged a nail trim for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.TemperatureLogged => $"Logged a temperature reading of {result.TemperatureC?.ToString("0.#", CultureInfo.InvariantCulture)} degrees Celsius for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.SpitUpLogged => $"Logged spit-up for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.TeethingLogged => $"Logged teething for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.MilestoneLogged => $"Logged a milestone for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.SymptomLogged => $"Logged a symptom for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.OutdoorStarted => $"Outdoor time started for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.SkinCareLogged => $"Logged skin care for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.MedicationLogged => $"Recorded that {(SpokenMedicine.NameOf(result) is { } medicine ? $"a dose of {medicine}" : "a medication dose")} was given to {baby} at {Time(result, result.At)}, as the person said. Lotties does not check or suggest doses.",
            AssistantResultCode.NoActivePrescription => $"That medicine is not among the active prescriptions registered for {baby}; nothing was recorded.",
            AssistantResultCode.MedicationReminder => $"{result.Count ?? 0} medicine reminders registered by the family are due now for {baby}{(SpokenMedicine.DueNamesOf(result) is { Count: > 0 } dueNames ? $" ({string.Join(", ", dueNames)})" : string.Empty)}{(result.At is null ? string.Empty : $"; the next{(SpokenMedicine.NameOf(result) is { } next ? $" ({next})" : string.Empty)} is at {Time(result, result.At)}")}. These are reminders of the medicines the family registered in Lotties, not recommendations from Lotties: check the prescription and ask the doctor or pharmacist if in doubt.",
            AssistantResultCode.NoMedicationDue => $"No medicine reminder registered by the family is due or scheduled for {baby}. These are reminders of the medicines the family registered in Lotties, not recommendations from Lotties.",
            AssistantResultCode.InvalidDate => $"invalid_date: the date must be from {result.EarliestDate:yyyy-MM-dd} to {result.LatestDate:yyyy-MM-dd}{DaysIn(result)}.",
            AssistantResultCode.SleepStarted => $"Sleep started for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.SleepAlreadyRunning => $"{subject} is already sleeping, since {Time(result, result.At)}; nothing was logged.",
            AssistantResultCode.SleepEnded => $"{subject} woke up at {Time(result, result.At)}{Minutes(", after ", result.Minutes, " minutes of sleep")}.",
            AssistantResultCode.NoRunningSleep => $"{subject} is not sleeping; nothing was changed.",
            AssistantResultCode.SeveralRunningSleeps => $"{subject} has {result.Count} sleep timers running; nothing was changed (stop them in the app).",
            AssistantResultCode.BottleLogged => $"Logged a {Volume(result.AmountMl, result.Units)} bottle for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.NursingStarted => $"Nursing started for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.NursingAlreadyRunning => $"{subject} is already nursing, since {Time(result, result.At)}; nothing was logged.",
            AssistantResultCode.DiaperLogged => $"Logged a diaper for {baby} at {Time(result, result.At)}.",
            AssistantResultCode.LastFeed => $"{subject}'s last feed started at {Time(result, result.At)}{(result.Running == true ? " and is still running" : string.Empty)}.",
            AssistantResultCode.NoFeeds => $"No feed of {baby} in the last 30 days.",
            AssistantResultCode.Sleeping => $"{subject} has been sleeping since {Time(result, result.At)}{Minutes(" (", result.Minutes, " minutes)")}.",
            AssistantResultCode.Awake => $"{subject} has been awake since {Time(result, result.At)}{Minutes("; the last sleep lasted ", result.Minutes, " minutes")}.",
            AssistantResultCode.NoSleeps => $"No sleep of {baby} in the last 30 days.",
            AssistantResultCode.DiapersToday => $"{subject} has had {result.Count} diapers ({result.Wet} wet, {result.Dirty} dirty) {(result.Window == AssistantDayWindow.Today ? "today" : "in the last 24 hours")}.",
            AssistantResultCode.NextAppointment => $"{subject}'s next appointment{(DoctorSpecialties.Find(result.Appointment?.Specialty) is { } specialty ? $" is with {specialty.English}, and it" : string.Empty)} starts at {Time(result, result.Appointment?.StartsAt)}.",
            AssistantResultCode.NoAppointment => $"{subject} has no upcoming appointment.",
            AssistantResultCode.VaccinesDue => $"{result.Count} vaccine doses are due or overdue for {baby} by the schedule ({result.Overdue} overdue).",
            AssistantResultCode.NoVaccinesDue => $"No vaccine dose is due for {baby} by the schedule.",
            AssistantResultCode.Babies => $"{result.Babies.Count} babies.",
            AssistantResultCode.BabyProfile => $"{subject} is {result.Age?.Days} days old.",
            AssistantResultCode.DaySummary => $"Summary of {baby}'s day {result.Days.FirstOrDefault()?.Date:yyyy-MM-dd}{DaysIn(result)}.",
            AssistantResultCode.WeekSummary => $"Summary of {baby}'s 7 days up to {result.Days.LastOrDefault()?.Date:yyyy-MM-dd}{DaysIn(result)}.",
            AssistantResultCode.NextNapWindow => $"{subject}'s next nap window is expected between {Time(result, result.Estimate?.Earliest)} and {Time(result, result.Estimate?.Latest)}.",
            AssistantResultCode.NapWindowAsleep => $"{subject} is asleep since {Time(result, result.At)}{(result.EndedAt is null ? string.Empty : $"; expected wake-up around {Time(result, result.EndedAt)}")}.",
            AssistantResultCode.NoNapPrediction => $"No nap window for {baby}: not enough sleep history or a stale prediction.",
            AssistantResultCode.NextFeed => $"{subject}'s next feed is expected around {Time(result, result.Estimate?.Expected)}.",
            AssistantResultCode.NoNextFeed => $"No next feed estimate for {baby}: not enough feed history.",
            AssistantResultCode.NextDiaper => $"Next diaper for {baby}: wet around {Time(result, result.WetEstimate?.Expected)}, dirty around {Time(result, result.DirtyEstimate?.Expected)}.",
            AssistantResultCode.NoNextDiaper => $"No next diaper estimate for {baby}: not enough diaper history.",
            AssistantResultCode.DiapersAverage => $"{subject} used about {result.PerDay?.ToString("0.#", CultureInfo.InvariantCulture)} diapers a day over {result.Count} days ({result.WetPerDay?.ToString("0.#", CultureInfo.InvariantCulture)} wet, {result.DirtyPerDay?.ToString("0.#", CultureInfo.InvariantCulture)} dirty).",
            AssistantResultCode.NoDiapersAverage => $"Not enough complete days with diapers for {baby} in the last week ({result.Count} of 3 needed).",
            AssistantResultCode.BottleAverage => $"{subject}'s last {result.Count} bottles averaged {Volume(result.AmountMl, result.Units)}; the last was {Volume(result.LastAmountMl, result.Units)}.",
            AssistantResultCode.NoBottleData => $"Not enough bottles with an amount in the last 14 days for {baby} ({result.Count} of 3 needed).",
            AssistantResultCode.SleepToday => $"{subject} has slept {result.Minutes} minutes today, with {result.Count} naps.",
            AssistantResultCode.BottleToday => BottleToday(result, subject),
            AssistantResultCode.FeedsToday => $"{subject} has had {result.Count} feeds {(result.Window == AssistantDayWindow.Today ? "today" : "in the last 24 hours")}: {result.BottleFeeds} bottle, {result.BreastFeeds} breast, {result.SolidFeeds} solid.",
            AssistantResultCode.LastDiaper => $"{subject}'s last diaper was at {Time(result, result.At)}.",
            AssistantResultCode.NoDiapers => $"No diaper of {baby} in the last 30 days.",
            AssistantResultCode.CryReasons => $"What {baby}'s log suggests: {string.Join(", ", result.CryCauses.Select(cause => cause.Cause.ToString().ToLowerInvariant()))}. Not a diagnosis or medical advice: call the pediatrician or emergency services for a fever, crying that cannot be soothed, refusing feeds, unusual sleepiness, or a bulging or stiff soft spot.",
            AssistantResultCode.DeleteRequested => $"Asked to delete {baby}'s last {result.EntryType} entry from {Time(result, result.At)}. Nothing was deleted: the person approves or keeps it in the Lotties app.",
            AssistantResultCode.LastNotUndoable => $"The last entry this assistant made for {baby} was a wake-up at {Time(result, result.At)}. It cannot be undone by voice or assistant; nothing was changed. It can be corrected in the Lotties app.",
            AssistantResultCode.NoEntryToDelete => $"No entry made by this assistant in the last 30 minutes for {baby}; nothing was changed.",
            AssistantResultCode.CryNoData => $"Nothing in {baby}'s log points at a cause. Not a diagnosis or medical advice: call the pediatrician or emergency services for a fever, crying that cannot be soothed, refusing feeds, unusual sleepiness, or a bulging or stiff soft spot.",
            _ => AssistantResult.CodeName(result.Code),
        };
    }

    private static string BottleToday(AssistantResult result, string baby)
    {
        var window = result.Window == AssistantDayWindow.Today ? "today" : "in the last 24 hours";
        var split = result.FormulaBottles is { Bottles: > 0 } formula && result.BreastMilkBottles is { Bottles: > 0 } milk
            ? $" (formula {formula.Bottles} bottles, {Volume(formula.Ml, result.Units)}; breast milk {milk.Bottles} bottles, {Volume(milk.Ml, result.Units)})"
            : string.Empty;
        return result.Count is null or 0
            ? $"{baby} has had no bottles {window}."
            : $"{baby} has had {result.Count} bottles {window}, {Volume(result.AmountMl, result.Units)} drunk{split}.";
    }

    /// <summary>A volume told in the user's system: <c>120 ml</c>, or <c>4.1 fl oz</c> (the structured values stay in ml).</summary>
    private static string Volume(int? ml, UnitSystem units) => units == UnitSystem.Us
        ? $"{UnitConversions.Text(UnitConversions.MlToFluidOunces(ml ?? 0))} fl oz"
        : $"{ml} ml";

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
