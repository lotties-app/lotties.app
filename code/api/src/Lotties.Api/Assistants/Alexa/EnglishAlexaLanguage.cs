using System.Collections.Frozen;
using System.Globalization;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Units;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>English (every locale that is not Portuguese): 12-hour clock times ("3:15 PM"), no fallback time zone.</summary>
internal sealed partial class EnglishAlexaLanguage : IAlexaLanguage
{
    private static readonly SpokenClock Speech = new(CultureInfo.GetCultureInfo("en-US"), "h:mm tt", new SpokenWords("minute", "minutes", "hour", "hours", "and", "less than a minute"));

    private static readonly SpokenMeasures Measures = new(
        Speech.Culture,
        new SpokenUnitWords("ml", new("ounce", "ounces"), new("pound", "pounds"), new("kilogram", "kilograms"), new("centimeter", "centimeters"), new("inch", "inches"), new("degree", "degrees"), string.Empty),
        value => value == 1);

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
        [AssistantResultCode.ConsentRequired] = _ => "Before Lotties can use your baby's information, please open the Lotties app and accept the terms of use. Then try again.",
        [AssistantResultCode.NoBaby] = _ => "There's no baby in your Lotties account yet. Add one in the app first.",
        [AssistantResultCode.ChooseBaby] = _ => "You have more than one baby in Lotties. Choose the one for voice commands in the app, in Settings, Voice assistants.",
        [AssistantResultCode.RateLimited] = _ => "That's a lot of requests. Please try again in a minute.",
        [AssistantResultCode.InvalidAmount] = InvalidAmount,
        [AssistantResultCode.SleepStarted] = result => $"Got it. {Subject(result)} fell asleep {When(result, result.At)}.",
        [AssistantResultCode.SleepAlreadyRunning] = result => $"{Subject(result)} is already sleeping{SinceClause(result)}.",
        [AssistantResultCode.SleepEnded] = result => result.Minutes is null
            ? $"{Subject(result)} woke up {When(result, result.At)}."
            : $"{Subject(result)} woke up {When(result, result.At)}, after sleeping {Speech.Duration(result.Minutes)}.",
        [AssistantResultCode.NoRunningSleep] = result => $"{Subject(result)} isn't sleeping right now, so there was nothing to stop.",
        [AssistantResultCode.SeveralRunningSleeps] = result => $"{Subject(result)} has {result.Count} sleep timers running. Please stop them in the app.",
        [AssistantResultCode.BottleLogged] = result => $"Logged a {VolumeModifier(result, result.AmountMl)} bottle{BottleContent(result)} {When(result, result.At)} for {Name(result)}.",
        [AssistantResultCode.NursingStarted] = result => $"Nursing started on the {Side(result)} side for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.NursingAlreadyRunning] = result => $"{Subject(result)} is already nursing{SinceClause(result)}.",
        [AssistantResultCode.DiaperLogged] = result => $"Logged a {Diaper(result)} diaper for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.LastFeed] = LastFeed,
        [AssistantResultCode.NoFeeds] = result => $"I can't find a feed for {Name(result)} in the last 30 days.",
        [AssistantResultCode.Sleeping] = result => $"{Subject(result)} has been sleeping{SinceClause(result)}{(Speech.Clock(result, result.At) is null ? string.Empty : $", for {Speech.Duration(result.Minutes)}")}.",
        [AssistantResultCode.Awake] = result => $"{Subject(result)} has been awake{SinceClause(result)}. The last sleep lasted {Speech.Duration(result.Minutes)}.",
        [AssistantResultCode.NoSleeps] = result => $"I can't find a sleep for {Name(result)} in the last 30 days.",
        [AssistantResultCode.DiapersToday] = DiapersToday,
        [AssistantResultCode.NextAppointment] = result => $"{Subject(result)}'s next appointment is {AppointmentWith(result.Appointment!)}{Day(result, result.Appointment!.StartsAt)}.",
        [AssistantResultCode.NoAppointment] = result => $"{Subject(result)} has no upcoming appointments.",
        [AssistantResultCode.VaccinesDue] = VaccinesDue,
        [AssistantResultCode.NoVaccinesDue] = result => $"By the vaccine schedule, {Name(result)} has no vaccine doses due right now.",
        [AssistantResultCode.UnknownBaby] = _ => "I can't find that baby in your Lotties account.",
        [AssistantResultCode.InvalidDate] = _ => "Please ask about a day within the last year, up to today.",
        [AssistantResultCode.Babies] = result => result.Babies.Count == 0
            ? "There's no baby in your Lotties account yet."
            : SpokenBaby.NamesOfListed(result) is { } names
                ? $"Your babies in Lotties: {Speech.List(names.ToArray())}."
                : $"You have {Speech.Count(result.Babies.Count, "baby", "babies")} in Lotties. To choose the one voice commands are about, open the app, then Settings, Voice assistants.",
        [AssistantResultCode.BabyProfile] = result => $"{Subject(result)} is {Age(result.Age)}.",
        [AssistantResultCode.DaySummary] = DaySummary,
        [AssistantResultCode.WeekSummary] = WeekSummary,
        [AssistantResultCode.BathLogged] = result => $"Logged a bath for {Name(result)} {When(result, result.At)}{(result.TemperatureC is { } temp ? $", water at {Measures.Temperature(temp, result.Units)}" : "")}.",
        [AssistantResultCode.TummyTimeStarted] = result => $"Tummy time started for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.BellyPainLogged] = result => $"Logged belly pain for {Name(result)} {When(result, result.At)}{(result.Intensity is { } i ? $", intensity {i}" : "")}.",
        [AssistantResultCode.BreastPumpStarted] = result => $"Breast pump session started for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.NasalSuctionLogged] = result => $"Logged nasal suction for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.BellyMassageStarted] = result => $"Belly massage started for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.FussyStarted] = result => $"Fussy timer started for {Name(result)} {When(result, result.At)}{(result.Intensity is { } i ? $", {i}" : "")}.",
        [AssistantResultCode.NailTrimLogged] = result => $"Logged a nail trim for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.TemperatureLogged] = result => $"Logged a temperature of {Measures.Temperature(result.TemperatureC ?? 0, result.Units)} for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.SpitUpLogged] = result => $"Logged spit-up for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.TeethingLogged] = result => $"Logged teething for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.MilestoneLogged] = result => $"Logged a milestone for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.SymptomLogged] = result => $"Logged a symptom for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.OutdoorStarted] = result => $"Outdoor time started for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.SkinCareLogged] = result => $"Logged skin care for {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.MedicationLogged] = result => $"I recorded that {(SpokenMedicine.NameOf(result) is { } medicine ? $"a dose of {medicine}" : "a medication dose")} was given to {Name(result)} {When(result, result.At)}, as you told me. Lotties doesn't check or suggest doses.",
        [AssistantResultCode.NoActivePrescription] = result => $"I can't find that medicine among the active prescriptions registered for {Name(result)} in Lotties, so nothing was recorded. Check the app.",
        [AssistantResultCode.MedicationReminder] = MedicationReminder,
        [AssistantResultCode.NoMedicationDue] = result => $"There are no medicine reminders registered in Lotties for {Name(result)} right now. {MedicationNotice}",
        [AssistantResultCode.InvalidValue] = InvalidValue,
    };

    /// <summary>Said with every medicine reminder: they are the family's own, never advice from Lotties.</summary>
    public const string MedicationNotice = "These are reminders of the medicines you registered in Lotties, not recommendations from Lotties. Check the prescription, and ask your doctor or pharmacist if you have doubts.";

    private static string MedicationReminder(AssistantResult result)
    {
        var count = result.Count ?? 0;
        var due = count switch
        {
            0 => $"No medicine reminder you registered in Lotties is due now for {Name(result)}.",
            1 => $"One medicine reminder you registered in Lotties is due now for {Name(result)}.",
            _ => $"{count} medicine reminders you registered in Lotties are due now for {Name(result)}.",
        };
        var names = SpokenMedicine.DueNamesOf(result) is { Count: > 0 } dueNames ? $" Due now: {Speech.List(dueNames)}." : string.Empty;
        var nextName = SpokenMedicine.NameOf(result) is { } medicine ? $" ({medicine})" : string.Empty;
        var next = result.At is { } at ? $" The next one{nextName} is {Day(result, at)}." : string.Empty;
        return $"{due}{names}{next} {MedicationNotice}";
    }

    private static string InvalidValue(AssistantResult result)
    {
        var us = result.Units == UnitSystem.Us;
        return result.Field switch
        {
            "temperature" => us
                ? $"Please say a temperature from {Measures.Number(UnitConversions.CelsiusToFahrenheit(result.Min ?? 0))} to {Measures.Number(UnitConversions.CelsiusToFahrenheit(result.Max ?? 0))} degrees, for example: log temperature 99."
                : $"Please say a temperature from {result.Min} to {result.Max} degrees, for example: log temperature 37.",
            "water_temperature" => us
                ? $"Please say a water temperature from {Measures.Number(UnitConversions.CelsiusToFahrenheit(result.Min ?? 0))} to {Measures.Number(UnitConversions.CelsiusToFahrenheit(result.Max ?? 0))} degrees."
                : $"Please say a water temperature from {result.Min} to {result.Max} degrees.",
            "pain_level" => $"Please say a level from {result.Min} to {result.Max}, for example: belly pain level 3.",
            "pump_amount" => $"Please say an amount from {result.Min} to {result.Max} ml, for example: pumped 100 ml on the left.",
            _ => "That value is out of range, so nothing was logged.",
        };
    }

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
        return $"{when}, {Name(result)} {Totals(SpokenDayTotals.Of(result.Days), result.Units)}.";
    }

    private static string WeekSummary(AssistantResult result)
    {
        var last = result.Days.Count == 0 ? "today" : result.Days[^1].Date.ToString("MMMM d", Speech.Culture);
        return $"In the 7 days up to {last}, {Name(result)} {Totals(SpokenDayTotals.Of(result.Days), result.Units)}.";
    }

    private static string Totals(SpokenDayTotals totals, UnitSystem units)
    {
        var bottles = totals.BottleMl > 0 ? $" with {Measures.Volume(totals.BottleMl, units)} in bottles" : string.Empty;
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
        [AlexaPrompt.PainLevelMissing] = new("How strong is the belly pain, from 1 to 5? For example, say: belly pain level 3."),
        [AlexaPrompt.TemperatureMissing] = new("What was the temperature? For example, say: log temperature 37."),
        [AlexaPrompt.MedicationNameMissing] = new("Which medicine did you give? Say the name you registered in Lotties, for example: gave her, and then the name."),
        [AlexaPrompt.Error] = new("Sorry, something went wrong. Please try again."),
    };

    private static string LastFeed(AssistantResult result)
    {
        var feed = FeedDescription(result);
        return result.Running == true
            ? $"{Subject(result)} is feeding now: {feed}, started {When(result, result.At)}."
            : $"{Subject(result)}'s last feed was {feed}, {AtAndAgo(result, result.At)}.";
    }

    private static string DiapersToday(AssistantResult result)
    {
        var window = result.Window == AssistantDayWindow.Today ? "today" : "in the last 24 hours";
        return result.Count is null or 0
            ? $"{Subject(result)} has had no diapers {window}."
            : $"{Subject(result)} has had {Speech.Count(result.Count.Value, "diaper", "diapers")} {window}: {result.Wet} wet and {result.Dirty} dirty.";
    }

    private static string VaccinesDue(AssistantResult result)
    {
        var overdue = result.Overdue is > 0 ? $", {result.Overdue} of them overdue" : string.Empty;
        var names = Speech.List(result.Vaccines.Select(dose => Localized(dose.Names)).Distinct(StringComparer.Ordinal).ToArray());
        return $"By the vaccine schedule, {Name(result)} has {Speech.Count(result.Count ?? 0, "vaccine dose", "vaccine doses")} due{overdue}: {names}. You can see them in the app.";
    }

    private static string FeedDescription(AssistantResult result) => result.FeedMethod switch
    {
        FeedMethod.Bottle when result.AmountMl is { } amount => $"a {VolumeModifier(result, amount)} bottle{BottleContent(result)}",
        FeedMethod.Bottle => $"a bottle{BottleContent(result)}",
        FeedMethod.Breast when result.Side is not null => $"nursing on the {Side(result)} side",
        FeedMethod.Breast => "nursing",
        FeedMethod.Solid => "solid food",
        _ => "a feed",
    };

    private static string BottleContent(AssistantResult result) => result.BottleKind switch
    {
        BottleKind.Formula => " of formula",
        BottleKind.BreastMilk => " of breast milk",
        _ => string.Empty,
    };

    private static string Volume(AssistantResult result, int? ml) => Measures.Volume(ml ?? 0, result.Units);

    private static string VolumeModifier(AssistantResult result, int? ml) => Measures.VolumeModifier(ml ?? 0, result.Units);

    private static string InvalidAmount(AssistantResult result) => result.Units == UnitSystem.Us
        ? $"Please say an amount up to {Measures.Number(UnitConversions.MlToFluidOunces(result.Max ?? 0))} ounces, for example: log a 4 ounce bottle."
        : $"Please say an amount from {result.Min} to {result.Max} ml, for example: log a 120 ml bottle.";

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

    /// <summary>" since 3:15 PM", or " for 20 minutes" without a known zone (never "since 20 minutes ago").</summary>
    private static string SinceClause(AssistantResult result) =>
        Speech.Clock(result, result.At) is { } clock ? $" since {clock}" : result.At is { } at ? $" for {Speech.Duration(Speech.MinutesBetween(at, result.AsOf))}" : string.Empty;

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

    /// <summary>The baby's name when the user allowed it, else "the baby" (mid-sentence).</summary>
    private static string Name(AssistantResult result) => SpokenBaby.NameOf(result) ?? "the baby";

    /// <summary>As <see cref="Name"/> at the start of a sentence.</summary>
    private static string Subject(AssistantResult result) => SpokenBaby.NameOf(result) ?? "The baby";

    /// <summary>"with a pediatrician, " when the specialty is a known one, else the kind when it says something ("a vaccination, "), else nothing.</summary>
    private static string AppointmentWith(AssistantAppointment appointment) =>
        DoctorSpecialties.Find(appointment.Specialty) is { } specialty ? $"with {specialty.English}, " : AppointmentKind(appointment.Type) is { Length: > 0 } kind ? kind + ", " : string.Empty;

    private static string AppointmentKind(string? type) => type switch
    {
        "vaccine" => "a vaccination",
        "exam" => "an exam",
        _ => string.Empty,
    };
}
