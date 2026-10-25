using System.Collections.Frozen;
using System.Globalization;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>English (every locale that is not Portuguese): 12-hour clock times ("3:15 PM"), no fallback time zone.</summary>
internal sealed partial class EnglishAlexaLanguage : IAlexaLanguage
{
    private static readonly SpokenClock Speech = new(CultureInfo.GetCultureInfo("en-US"), "h:mm tt", new SpokenWords("minute", "minutes", "hour", "hours", "and", "less than a minute"));

    private readonly FrozenDictionary<AssistantResultCode, Func<AssistantResult, string>> _results;
    private readonly FrozenDictionary<AlexaPrompt, AlexaLine> _prompts;

    public EnglishAlexaLanguage()
    {
        _results = Results().Concat(ForecastResults()).ToFrozenDictionary();
        _prompts = Prompts().ToFrozenDictionary();
    }

    public string Locale => "en-US";

    public string? FallbackTimeZone => null;

    public bool CanHandle(string? locale) => locale?.StartsWith("en", StringComparison.OrdinalIgnoreCase) == true;

    public string Say(AssistantResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return _results[result.Code](result);
    }

    public AlexaLine Say(AlexaPrompt prompt) => _prompts[prompt];

    private static Dictionary<AssistantResultCode, Func<AssistantResult, string>> Results() => new()
    {
        [AssistantResultCode.NotAllowed] = result => result.Baby is null
            ? "Voice commands are for the baby's family. Your account can't use them here."
            : $"Your role on {Name(result)} doesn't allow this. Ask the baby's owner in the app.",
        [AssistantResultCode.NoBaby] = _ => "There's no baby in your Lotties account yet. Add one in the app first.",
        [AssistantResultCode.ChooseBaby] = _ => "You have more than one baby in Lotties. Choose the one for voice commands in the app, in Settings, Voice assistants.",
        [AssistantResultCode.RateLimited] = _ => "That's a lot of requests. Please try again in a minute.",
        [AssistantResultCode.InvalidAmount] = result => $"Please say an amount from {result.Min} to {result.Max} ml, for example: log a 120 ml bottle.",
        [AssistantResultCode.SleepStarted] = result => $"Got it. {Name(result)} fell asleep {When(result, result.At)}.",
        [AssistantResultCode.SleepAlreadyRunning] = result => $"{Name(result)} is already sleeping, since {Since(result, result.At)}.",
        [AssistantResultCode.SleepEnded] = result => result.Minutes is null
            ? $"{Name(result)} woke up {When(result, result.At)}."
            : $"{Name(result)} woke up {When(result, result.At)}, after sleeping {Speech.Duration(result.Minutes)}.",
        [AssistantResultCode.NoRunningSleep] = result => $"{Name(result)} isn't sleeping right now, so there was nothing to stop.",
        [AssistantResultCode.SeveralRunningSleeps] = result => $"{Name(result)} has {result.Count} sleep timers running. Please stop them in the app.",
        [AssistantResultCode.BottleLogged] = result => $"Logged a {result.AmountMl} ml bottle{BottleContent(result)} {When(result, result.At)} for {Name(result)}.",
        [AssistantResultCode.NursingStarted] = result => $"Nursing started on the {Side(result)} side for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.NursingAlreadyRunning] = result => $"{Name(result)} is already nursing, since {Since(result, result.At)}.",
        [AssistantResultCode.DiaperLogged] = result => $"Logged a {Diaper(result)} diaper for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.LastFeed] = LastFeed,
        [AssistantResultCode.NoFeeds] = result => $"I can't find a feed for {Name(result)} in the last 30 days.",
        [AssistantResultCode.Sleeping] = result => $"{Name(result)} has been sleeping since {Since(result, result.At)}, for {Speech.Duration(result.Minutes)}.",
        [AssistantResultCode.Awake] = result => $"{Name(result)} has been awake since {Since(result, result.At)}. The last sleep lasted {Speech.Duration(result.Minutes)}.",
        [AssistantResultCode.NoSleeps] = result => $"I can't find a sleep for {Name(result)} in the last 30 days.",
        [AssistantResultCode.DiapersToday] = DiapersToday,
        [AssistantResultCode.NextAppointment] = result => $"{Name(result)}'s next appointment is {result.Appointment!.Title}, {Day(result, result.Appointment.StartsAt)}.",
        [AssistantResultCode.NoAppointment] = result => $"{Name(result)} has no upcoming appointments.",
        [AssistantResultCode.VaccinesDue] = VaccinesDue,
        [AssistantResultCode.NoVaccinesDue] = result => $"By the vaccine schedule, {Name(result)} has no vaccine doses due right now.",
        [AssistantResultCode.UnknownBaby] = _ => "I can't find that baby in your Lotties account.",
        [AssistantResultCode.InvalidDate] = _ => "Please ask about a day within the last year, up to today.",
        [AssistantResultCode.Babies] = result => result.Babies.Count == 0
            ? "There's no baby in your Lotties account yet."
            : $"Your babies in Lotties: {Speech.List(result.Babies.Select(baby => baby.Name).ToArray())}.",
        [AssistantResultCode.BabyProfile] = result => $"{Name(result)} is {Age(result.Age)}.",
        [AssistantResultCode.DaySummary] = DaySummary,
        [AssistantResultCode.WeekSummary] = WeekSummary,
    };

    private static string Age(AssistantBabyAge? age) => age switch
    {
        null or { Days: 0 } => "a newborn",
        { Months: > 0 } => $"{Speech.Count(age.Months, "month", "months")} old",
        { Weeks: > 0 } => $"{Speech.Count(age.Weeks, "week", "weeks")} old",
        _ => $"{Speech.Count(age.Days, "day", "days")} old",
    };

    private static string DaySummary(AssistantResult result)
    {
        var day = result.Days.FirstOrDefault();
        var when = day switch
        {
            null => "That day",
            { Complete: false } => "So far today",
            _ => $"On {day.Date.ToString("MMMM d", Speech.Culture)}",
        };
        return $"{when}, {Name(result)} {Totals(SpokenDayTotals.Of(result.Days))}.";
    }

    private static string WeekSummary(AssistantResult result)
    {
        var last = result.Days.Count == 0 ? "today" : result.Days[^1].Date.ToString("MMMM d", Speech.Culture);
        return $"In the 7 days up to {last}, {Name(result)} {Totals(SpokenDayTotals.Of(result.Days))}.";
    }

    private static string Totals(SpokenDayTotals totals)
    {
        var bottles = totals.BottleMl > 0 ? $" with {totals.BottleMl} ml in bottles" : string.Empty;
        return $"slept {Speech.Duration(totals.SleepMinutes)} with {Speech.Count(totals.Naps, "nap", "naps")}, had {Speech.Count(totals.Feeds, "feed", "feeds")}{bottles}, and {Speech.Count(totals.Diapers, "diaper", "diapers")}";
    }

    private static Dictionary<AlexaPrompt, AlexaLine> Prompts() => new()
    {
        [AlexaPrompt.Welcome] = new("Welcome to Lotties. You can say things like: the baby fell asleep, log a 120 ml bottle, or when was the last feed?", "What would you like to do?"),
        [AlexaPrompt.Help] = new("You can log sleep, bottles, nursing and diapers, and ask about the last feed or diaper, sleep, today's diapers, the next nap, feed or diaper change, the next appointment, vaccines due, or why the baby is crying. For example: the baby woke up. What would you like to do?", "What would you like to do?"),
        [AlexaPrompt.Goodbye] = new("Goodbye."),
        [AlexaPrompt.Fallback] = new("Sorry, Lotties can't help with that. Say help to hear what you can do.", "What would you like to do?"),
        [AlexaPrompt.SetBabyHelp] = new("To choose the baby voice commands are about, open the Lotties app, then Settings, Voice assistants."),
        [AlexaPrompt.LinkAccount] = new("Please link your Lotties account in the Alexa app to use this skill."),
        [AlexaPrompt.DiaperKindMissing] = new("Was the diaper wet, dirty, or both? For example, say: log a wet diaper."),
        [AlexaPrompt.Error] = new("Sorry, something went wrong. Please try again."),
    };

    private static string LastFeed(AssistantResult result)
    {
        var feed = FeedDescription(result);
        return result.Running == true
            ? $"{Name(result)} is feeding now: {feed}, started {When(result, result.At)}."
            : $"{Name(result)}'s last feed was {feed}, {AtAndAgo(result, result.At)}.";
    }

    private static string DiapersToday(AssistantResult result)
    {
        var window = result.Window == AssistantDayWindow.Today ? "today" : "in the last 24 hours";
        return result.Count is null or 0
            ? $"{Name(result)} has had no diapers {window}."
            : $"{Name(result)} has had {Speech.Count(result.Count.Value, "diaper", "diapers")} {window}: {result.Wet} wet and {result.Dirty} dirty.";
    }

    private static string VaccinesDue(AssistantResult result)
    {
        var overdue = result.Overdue is > 0 ? $", {result.Overdue} of them overdue" : string.Empty;
        var names = Speech.List(result.Vaccines.Select(dose => Localized(dose.Names)).Distinct(StringComparer.Ordinal).ToArray());
        return $"By the vaccine schedule, {Name(result)} has {Speech.Count(result.Count ?? 0, "vaccine dose", "vaccine doses")} due{overdue}: {names}. You can see them in the app.";
    }

    private static string FeedDescription(AssistantResult result) => result.FeedMethod switch
    {
        FeedMethod.Bottle when result.AmountMl is { } amount => $"a {amount} ml bottle{BottleContent(result)}",
        FeedMethod.Bottle => $"a bottle{BottleContent(result)}",
        FeedMethod.Breast when result.Side is not null => $"nursing on the {Side(result)} side",
        FeedMethod.Breast => "nursing",
        FeedMethod.Solid => "solid food",
        _ => "a feed",
    };

    private static string BottleContent(AssistantResult result) => result.BottleKind switch
    {
        BottleKind.Formula when !string.IsNullOrWhiteSpace(result.FormulaName) => $" of {result.FormulaName}",
        BottleKind.Formula => " of formula",
        BottleKind.BreastMilk => " of breast milk",
        _ => string.Empty,
    };

    private static string Side(AssistantResult result) => result.Side == BreastSide.Right ? "right" : "left";

    private static string Diaper(AssistantResult result) => result.Diaper switch
    {
        DiaperKind.Dirty => "dirty",
        DiaperKind.Both => "wet and dirty",
        _ => "wet",
    };

    /// <summary>"at 3:15 PM", or "just now" / "20 minutes ago" without a known zone.</summary>
    private static string When(AssistantResult result, DateTimeOffset? instant) =>
        Speech.Clock(result, instant) is { } clock ? $"at {clock}" : instant is { } value && Speech.MinutesBetween(value, result.AsOf) < 1 ? "just now" : Ago(result, instant);

    /// <summary>"3:15 PM", or "20 minutes ago" without a known zone.</summary>
    private static string Since(AssistantResult result, DateTimeOffset? instant) => Speech.Clock(result, instant) ?? Ago(result, instant);

    /// <summary>"at 3:15 PM, 20 minutes ago", or "20 minutes ago" without a known zone.</summary>
    private static string AtAndAgo(AssistantResult result, DateTimeOffset? instant) =>
        Speech.Clock(result, instant) is { } clock ? $"at {clock}, {Ago(result, instant)}" : Ago(result, instant);

    private static string Ago(AssistantResult result, DateTimeOffset? instant) =>
        instant is { } value ? $"{Speech.Duration(Speech.MinutesBetween(value, result.AsOf))} ago" : string.Empty;

    /// <summary>"today at 3:15 PM", "tomorrow at 9:00 AM", "on Tuesday, October 28 at 3:15 PM", or "in 3 days" without a zone.</summary>
    private static string Day(AssistantResult result, DateTimeOffset instant)
    {
        if (Speech.Local(result, instant) is not { } local || Speech.Local(result, result.AsOf) is not { } today)
        {
            return $"in {Speech.Duration(Speech.MinutesBetween(result.AsOf, instant))}";
        }

        var days = (local.Date - today.Date).Days;
        var date = days switch { 0 => "today", 1 => "tomorrow", _ => $"on {local.ToString("dddd, MMMM d", Speech.Culture)}" };
        return $"{date} at {Speech.Clock(result, instant)}";
    }

    private static string Localized(IReadOnlyDictionary<string, string> names) =>
        names.TryGetValue("en", out var english) ? english : names.Values.FirstOrDefault() ?? string.Empty;

    private static string Name(AssistantResult result) => result.Baby?.Name ?? "the baby";
}
