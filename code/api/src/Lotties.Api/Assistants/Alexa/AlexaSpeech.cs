using System.Globalization;
using System.Security;
using Lotties.Application.Assistants;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>The skill's own lines (not command results).</summary>
public enum AlexaPrompt
{
    Welcome,
    Help,
    Goodbye,
    Fallback,
    SetBabyHelp,
    LinkAccount,
    DiaperKindMissing,
    PainLevelMissing,
    TemperatureMissing,
    MedicationNameMissing,
    Error,
}

/// <summary>A line to speak, and the reprompt when the skill waits for an answer (the session then stays open).</summary>
public sealed record AlexaLine(string Text, string? Reprompt = null);

/// <summary>
/// One language of the skill: picks itself by the request locale (<see cref="CanHandle"/>), renders every
/// <see cref="AssistantResultCode"/> and <see cref="AlexaPrompt"/> as one short plain sentence (no advice, no health
/// claims; the baby's name from her profile), and names the time zone to fall back on when the user stored none.
/// </summary>
public interface IAlexaLanguage
{
    string Locale { get; }

    string? FallbackTimeZone { get; }

    bool CanHandle(string? locale);

    string Say(AssistantResult result);

    AlexaLine Say(AlexaPrompt prompt);
}

/// <summary>The skill's languages: Brazilian Portuguese for <c>pt-*</c>, English for every other locale.</summary>
public static class AlexaLanguages
{
    public static IReadOnlyList<IAlexaLanguage> All { get; } = [new PortugueseAlexaLanguage(), new EnglishAlexaLanguage()];

    public static IAlexaLanguage For(string? locale) => All.FirstOrDefault(language => language.CanHandle(locale)) ?? All[^1];
}

/// <summary>SSML for a plain sentence: every character XML-escaped (names and titles are the family's own text), inside <c>&lt;speak&gt;</c>.</summary>
public static class Ssml
{
    public static string Speak(string text) => $"<speak>{SecurityElement.Escape(text)}</speak>";

    public static AlexaOutputSpeech Of(string text) => new("SSML", Speak(text));
}

/// <summary>Times, durations and lists in one culture: clock times in the result's zone, else relative ("20 minutes ago").</summary>
internal sealed class SpokenClock(CultureInfo culture, string clockPattern, SpokenWords words)
{
    public CultureInfo Culture => culture;

    public string? Clock(AssistantResult result, DateTimeOffset? instant) =>
        instant is { } value && Zone(result) is { } zone ? TimeZoneInfo.ConvertTime(value, zone).ToString(clockPattern, culture) : null;

    /// <summary>A local wall-clock time in this culture's clock style.</summary>
    public string Clock(TimeOnly time) => time.ToString(clockPattern, culture);

    public DateTime? Local(AssistantResult result, DateTimeOffset instant) =>
        Zone(result) is { } zone ? TimeZoneInfo.ConvertTime(instant, zone).DateTime : null;

    public string Duration(int? minutes) => minutes switch
    {
        null or < 1 => words.LessThanAMinute,
        < 60 => Count(minutes.Value, words.Minute, words.Minutes),
        _ when minutes.Value % 60 == 0 => Count(minutes.Value / 60, words.Hour, words.Hours),
        _ => $"{Count(minutes.Value / 60, words.Hour, words.Hours)} {words.And} {Count(minutes.Value % 60, words.Minute, words.Minutes)}",
    };

    public int MinutesBetween(DateTimeOffset from, DateTimeOffset to) => (int)Math.Max(0, Math.Floor((to - from).TotalMinutes));

    public string Count(int count, string singular, string plural) => $"{count.ToString(culture)} {(count == 1 ? singular : plural)}";

    public string List(IReadOnlyList<string> items) => items.Count switch
    {
        0 => string.Empty,
        1 => items[0],
        _ => $"{string.Join(", ", items.Take(items.Count - 1))} {words.And} {items[^1]}",
    };

    private static TimeZoneInfo? Zone(AssistantResult result) =>
        result.TimeZone is { } id && TimeZoneInfo.TryFindSystemTimeZoneById(id, out var zone) ? zone : null;
}

/// <summary>The totals a spoken day or week summary tells: sleep minutes, naps, feeds, bottle ml and diapers over its days.</summary>
internal sealed record SpokenDayTotals(int SleepMinutes, int Naps, int Feeds, int BottleMl, int Diapers)
{
    public static SpokenDayTotals Of(IReadOnlyList<AssistantDaySummary> days) => new(
        days.Sum(day => day.Sleep.TotalMinutes),
        days.Sum(day => day.Sleep.Naps),
        days.Sum(day => day.Feeding.Feeds),
        (int)Math.Round(days.Sum(day => day.Feeding.BottleMl), MidpointRounding.AwayFromZero),
        days.Sum(day => day.Diapers.Total));
}

/// <summary>The duration and list words of a language.</summary>
internal sealed record SpokenWords(string Minute, string Minutes, string Hour, string Hours, string And, string LessThanAMinute);
