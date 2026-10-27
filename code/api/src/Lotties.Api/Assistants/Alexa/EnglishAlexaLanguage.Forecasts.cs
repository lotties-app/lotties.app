using System.Globalization;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.CryReasons;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>
/// The predictions and "why is she crying" answers in English: estimates and facts from the family's own log, one short
/// sentence per fact, never a diagnosis, advice, remedy or dose. The cry answers always end with the red flags to call the
/// pediatrician for, the wording of the web's "When to call for help" list.
/// </summary>
internal sealed partial class EnglishAlexaLanguage
{
    private static Dictionary<AssistantResultCode, Func<AssistantResult, string>> ForecastResults() => new()
    {
        [AssistantResultCode.NextNapWindow] = NextNapWindow,
        [AssistantResultCode.NapWindowAsleep] = NapWindowAsleep,
        [AssistantResultCode.NoNapPrediction] = result => $"I don't have enough sleep history yet to estimate {Name(result)}'s next nap window.",
        [AssistantResultCode.NextFeed] = result => $"{Subject(result)}'s next feed {Expected(result, result.Estimate!)}.",
        [AssistantResultCode.NoNextFeed] = result => $"I don't have enough feeds logged yet to estimate {Name(result)}'s next feed.",
        [AssistantResultCode.NextDiaper] = NextDiaper,
        [AssistantResultCode.NoNextDiaper] = result => $"I don't have enough diapers logged yet to estimate {Name(result)}'s next change.",
        [AssistantResultCode.DiapersAverage] = result =>
            $"Over the last {Speech.Count(result.Count ?? 0, "day", "days")} with diapers, {Name(result)} used about {Number(result.PerDay)} diapers a day: about {Number(result.WetPerDay)} wet and {Number(result.DirtyPerDay)} dirty.",
        [AssistantResultCode.NoDiapersAverage] = result =>
            $"I need at least 3 complete days of diapers in the last week to give an average, and I found {result.Count ?? 0}.",
        [AssistantResultCode.BottleAverage] = result =>
            $"{Subject(result)}'s last {Speech.Count(result.Count ?? 0, "bottle", "bottles")} averaged {Volume(result, result.AmountMl)}, and the last one was {Volume(result, result.LastAmountMl)}.",
        [AssistantResultCode.NoBottleData] = result =>
            $"There aren't enough bottles with an amount logged in the last 14 days: I need at least 3, and I found {result.Count ?? 0}.",
        [AssistantResultCode.SleepToday] = SleepToday,
        [AssistantResultCode.BottleToday] = BottleToday,
        [AssistantResultCode.FeedsToday] = FeedsToday,
        [AssistantResultCode.LastDiaper] = result =>
            $"{Subject(result)}'s last diaper was {LastDiaperContent(result)}, {AtAndAgo(result, result.At)}.",
        [AssistantResultCode.NoDiapers] = result => $"I can't find a diaper for {Name(result)} in the last 30 days.",
        [AssistantResultCode.CryReasons] = CryReasons,
        [AssistantResultCode.CryNoData] = CryNoData,
        [AssistantResultCode.DeleteRequested] = result =>
            $"I asked to delete {Name(result)}'s last {EntryName(result.EntryType)}, {When(result, result.At)}. Nothing was deleted: open the Lotties app to approve it or keep it.",
        [AssistantResultCode.LastNotUndoable] = result =>
            $"The last thing you logged by voice for {Name(result)} was a wake-up, {When(result, result.At)}. That can't be undone by voice, so nothing was changed. You can correct it in the Lotties app.",
        [AssistantResultCode.NoEntryToDelete] = _ => "I can't find an entry you logged by voice in the last 30 minutes, so nothing was changed.",
    };

    private static string EntryName(string? type) => type switch
    {
        "feeding" => "feed",
        "sleep" => "sleep",
        "diaper" => "diaper change",
        _ => "entry",
    };

    private static string TodayWindow(AssistantResult result) => result.Window == AssistantDayWindow.Today ? "today" : "in the last 24 hours";

    /// <summary>The bottles of the day: how many and the ml drunk, with the formula and breast milk split when both exist; facts only.</summary>
    private static string BottleToday(AssistantResult result)
    {
        var window = TodayWindow(result);
        var count = result.Count ?? 0;
        if (count == 0)
        {
            return $"{Subject(result)} has had no bottles {window}.";
        }

        if ((result.AmountMl ?? 0) == 0)
        {
            return $"{Subject(result)} has had {Speech.Count(count, "bottle", "bottles")} {window}, with no amount logged.";
        }

        var total = $"{Subject(result)} drank {Volume(result, result.AmountMl)} in {Speech.Count(count, "bottle", "bottles")} {window}";
        return result.FormulaBottles is { Bottles: > 0 } formula && result.BreastMilkBottles is { Bottles: > 0 } milk
            ? $"{total}: {formula.Bottles} of formula, {Volume(result, formula.Ml)}, and {milk.Bottles} of breast milk, {Volume(result, milk.Ml)}."
            : $"{total}.";
    }

    /// <summary>The feeds of the day with the bottle, nursing and solid split in one sentence.</summary>
    private static string FeedsToday(AssistantResult result)
    {
        var window = TodayWindow(result);
        var count = result.Count ?? 0;
        if (count == 0)
        {
            return $"{Subject(result)} has had no feeds {window}.";
        }

        var parts = new[]
        {
            result.BottleFeeds is > 0 ? Speech.Count(result.BottleFeeds.Value, "bottle", "bottles") : null,
            result.BreastFeeds is > 0 ? Speech.Count(result.BreastFeeds.Value, "nursing session", "nursing sessions") : null,
            result.SolidFeeds is > 0 ? Speech.Count(result.SolidFeeds.Value, "solid meal", "solid meals") : null,
        }.OfType<string>().ToArray();
        var split = parts.Length == 0 ? string.Empty : $": {Speech.List(parts)}";
        return $"{Subject(result)} has had {Speech.Count(count, "feed", "feeds")} {window}{split}.";
    }

    private static string SleepToday(AssistantResult result)
    {
        var slept = Speech.Duration(result.Minutes);
        return (result.Minutes, result.Count) switch
        {
            (null or 0, _) => $"{Subject(result)} has no sleep logged today.",
            (_, null or 0) => $"{Subject(result)} has slept {slept} today, with no naps.",
            _ => $"{Subject(result)} has slept {slept} today, with {Speech.Count(result.Count.Value, "nap", "naps")}.",
        };
    }

    private static string NextNapWindow(AssistantResult result)
    {
        var window = result.Estimate!;
        return window.Latest <= result.AsOf
            ? $"{Subject(result)}'s nap window was {Between(result, window)}."
            : $"{Subject(result)}'s next nap window is probably {Between(result, window)}.";
    }

    private static string NapWindowAsleep(AssistantResult result)
    {
        var asleep = $"{Subject(result)} is asleep{SinceClause(result)}.";
        return result.EndedAt is { } wakes ? $"{asleep} {Subject(result)} may wake up {Moment(result, wakes)}." : asleep;
    }

    private static string NextDiaper(AssistantResult result)
    {
        var sentences = new[]
        {
            result.WetEstimate is { } wet ? $"The next wet diaper {Expected(result, wet)}." : null,
            result.DirtyEstimate is { } dirty ? $"The next dirty diaper {Expected(result, dirty)}." : null,
        };
        return string.Join(' ', sentences.OfType<string>());
    }

    /// <summary>"is expected around 3:15 PM, usually between 2:50 PM and 3:40 PM" (or "was expected around ..." once it has passed).</summary>
    private static string Expected(AssistantResult result, AssistantTimeWindow window)
    {
        var verb = window.Latest <= result.AsOf ? "was expected" : "is expected";
        var usual = Speech.Clock(result, window.Earliest) is { } from && Speech.Clock(result, window.Latest) is { } to ? $", usually between {from} and {to}" : string.Empty;
        return $"{verb} {Moment(result, window.Expected)}{usual}";
    }

    /// <summary>"around 3:15 PM", or "in about 20 minutes" / "about 20 minutes ago" without a known zone.</summary>
    private static string Moment(AssistantResult result, DateTimeOffset instant)
    {
        if (Speech.Clock(result, instant) is { } clock)
        {
            return $"around {clock}";
        }

        return instant >= result.AsOf
            ? $"in about {Speech.Duration(Speech.MinutesBetween(result.AsOf, instant))}"
            : $"about {Speech.Duration(Speech.MinutesBetween(instant, result.AsOf))} ago";
    }

    /// <summary>"between 2:10 PM and 3:00 PM", or "around 2:30 PM" (the expected time) without a known zone.</summary>
    private static string Between(AssistantResult result, AssistantTimeWindow window) =>
        Speech.Clock(result, window.Earliest) is { } from && Speech.Clock(result, window.Latest) is { } to
            ? $"between {from} and {to}"
            : Moment(result, window.Expected);

    private static string Number(double? value) => (value ?? 0).ToString("0.#", Speech.Culture);

    private static string LastDiaperContent(AssistantResult result) => result.Diaper is null ? "a diaper" : $"a {Diaper(result)} diaper";

    private static string CryReasons(AssistantResult result)
    {
        var causes = AssistantCryCause.Spoken(result.CryCauses).Select((cause, index) => index == 0 ? LowerFirst(CauseSentence(result, cause)) : CauseSentence(result, cause)).ToArray();
        return $"From what is logged for {Name(result)}: {string.Join(' ', causes)} {CrySafety(result)}";
    }

    private static string LowerFirst(string sentence) => sentence.Length == 0 ? sentence : char.ToLowerInvariant(sentence[0]) + sentence[1..];

    private static string CryNoData(AssistantResult result)
    {
        var behind = result.Running == true ? "A sleep timer is still running, so the log may be behind." : "There isn't enough in the log to point at a cause.";
        return $"{behind} {CrySafety(result)}";
    }

    /// <summary>"Hunger looks likely: the last feed was 3 hours ago; the usual gap is about 2 hours and 30 minutes."</summary>
    private static string CauseSentence(AssistantResult result, AssistantCryCause cause)
    {
        var level = cause.Level == CryLevel.Likely ? "likely" : "possible";
        var facts = string.Join("; ", cause.Facts.Take(1).Select(fact => CryFactText(result, fact)));
        return $"{CryCauseName(cause.Cause)} looks {level}: {facts}.";
    }

    private static string CryCauseName(CryCause cause) => cause switch
    {
        CryCause.Hunger => "Hunger",
        CryCause.Sleepy => "Sleepiness",
        CryCause.Diaper => "The diaper",
        CryCause.Gas => "Gas",
        _ => "Comfort",
    };

    private static string CryFactText(AssistantResult result, CryFact fact) => fact.Kind switch
    {
        "sinceLastFeed" when fact.SmallerFeed == true => $"the last feed was {Speech.Duration(fact.Minutes)} ago and was smaller than usual",
        "sinceLastFeed" when fact.UsualGapMinutes is { } usual => $"the last feed was {Speech.Duration(fact.Minutes)} ago, and the usual gap is about {Speech.Duration(usual)}",
        "sinceLastFeed" => $"the last feed was {Speech.Duration(fact.Minutes)} ago",
        "feedingNow" => $"a feed is running, started {Speech.Duration(fact.Minutes)} ago",
        "awakeFor" when fact.WindowMinutes is { } window => $"awake for {Speech.Duration(fact.Minutes)}, and the usual stretch is about {Speech.Duration(window)}",
        "awakeFor" => $"awake for {Speech.Duration(fact.Minutes)}",
        "nightTime" => "it is night time",
        "sinceLastDiaper" when fact.UsualGapMinutes is { } usual => $"the last diaper was {Speech.Duration(fact.Minutes)} ago, and the usual gap is about {Speech.Duration(usual)}",
        "sinceLastDiaper" => $"the last diaper was {Speech.Duration(fact.Minutes)} ago",
        "dirtyDue" when fact.Signal == "afterFeed" => "a dirty diaper often comes about now after a feed",
        "dirtyDue" => $"a dirty diaper may come {DirtyDueMoment(result, fact)}",
        "recentFeedNoBurp" => $"fed {Speech.Duration(fact.MinutesSinceFeed)} ago, with no burp logged since",
        "reliefAfterFeed" => $"fed {Speech.Duration(fact.MinutesSinceFeed)} ago, and a burp or massage was logged",
        "bellyPattern" => $"belly pain often shows up around {ClockText(fact.TypicalClock)}",
        "eveningFussy" when fact.TypicalClock is not null => $"fussiness often starts around {ClockText(fact.TypicalClock)}",
        "eveningFussy" => "evenings are a common fussy time at this age",
        _ => "not enough is logged yet",
    };

    private static string DirtyDueMoment(AssistantResult result, CryFact fact) =>
        fact.ExpectedAt is { } at ? Moment(result, at) : "soon";

    private static string ClockText(string? clock) =>
        TimeOnly.TryParseExact(clock, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time) ? Speech.Clock(time) : clock ?? string.Empty;

    /// <summary>Always said after a cry answer: not a diagnosis, then the red flags to call for.</summary>
    private static string CrySafety(AssistantResult result)
    {
        var flags = result.RedFlags.Select(RedFlagText).ToArray();
        return $"This is not a diagnosis or medical advice. Call your pediatrician or emergency services if there is {Speech.List(flags)}.";
    }

    private static string RedFlagText(string flag) => flag switch
    {
        "fever" => "a fever (babies under 3 months with a fever need a call right away)",
        "inconsolable" => "crying you cannot soothe",
        "refusing_feeds" => "refusing feeds",
        "unusual_sleepiness" => "unusual sleepiness or being hard to wake",
        "bulging_or_stiff_fontanelle" => "a bulging or stiff soft spot on the head",
        _ => flag,
    };
}
