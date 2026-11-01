using System.Globalization;
using System.Text.Json.Nodes;
using Lotties.Application.Assistants;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>
/// What the night panel read: the results of the existing read commands, <c>null</c> for one that failed. The panel adds no
/// logic of its own (design 42): it only lays these results out.
/// </summary>
internal sealed record PanelReads(AssistantResult? Sleep, AssistantResult? LastFeed, AssistantResult? NextFeed, AssistantResult? LastDiaper, AssistantResult? NextNap)
{
    public IEnumerable<AssistantResult> Present => new[] { Sleep, LastFeed, NextFeed, LastDiaper, NextNap }.OfType<AssistantResult>();
}

/// <summary>One tile of the panel; every field is already text in the user's language ("—" is the dash of a tile that has no fact).</summary>
internal sealed record PanelTile(string Id, string Label, string Value, string Detail, string Note);

/// <summary>
/// The Echo Show night panel (docs/design/42-echo-show-panel.md): an APL document (static, language-neutral, embedded) and its
/// datasource, built from <see cref="PanelReads"/>. A tile whose result is not the success code of its read shows a dash, never a
/// number. No baby name unless <see cref="SpokenBaby"/> returns one, no medicine, no free text; estimates say they are estimates.
/// Nothing here is logged.
/// </summary>
internal static class AlexaPanel
{
    public const string Token = "lotties-panel";
    public const string RefreshArgument = "panelRefresh";
    public const string Dash = "—";

    private const string DocumentResource = "Lotties.Api.Assistants.Alexa.Panel.panel.apl.json";

    private static readonly Lazy<JsonNode> Document = new(LoadDocument);

    /// <summary>The panel as a RenderDocument directive, and how many of its four tiles have a fact.</summary>
    public static (AlexaDirective Directive, int Shown) Render(PanelReads reads, IAlexaLanguage language)
    {
        var tiles = Tiles(reads, language);
        var datasource = new JsonObject
        {
            ["panelData"] = new JsonObject
            {
                ["type"] = "object",
                ["objectId"] = "lottiesPanel",
                ["properties"] = new JsonObject
                {
                    ["header"] = Header(reads, language),
                    ["clock"] = Clock(reads, language),
                    ["stale"] = string.Empty,
                    ["tiles"] = new JsonArray(tiles.Select(Json).ToArray()),
                },
            },
        };
        var directive = new AlexaDirective("Alexa.Presentation.APL.RenderDocument", Token, Document.Value.DeepClone(), datasource);
        return (directive, tiles.Count(tile => tile.Value != Dash));
    }

    /// <summary>
    /// Keeps the screen the person already sees and only marks it as not updated (a refresh that could not run, e.g. the
    /// assistant limit): an ExecuteCommands directive that sets the small "stale" text. Nothing else on the screen changes.
    /// </summary>
    public static AlexaDirective MarkStale(IAlexaLanguage language) => new(
        "Alexa.Presentation.APL.ExecuteCommands",
        Token,
        Commands: new JsonArray(new JsonObject
        {
            ["type"] = "SetValue",
            ["componentId"] = "stale",
            ["property"] = "text",
            ["value"] = language.Panel.Stale,
        }));

    /// <summary>The spoken summary for a device without a screen: the three usual answers (the same sentences as the voice intents), without repeats.</summary>
    public static string Summary(PanelReads reads, IAlexaLanguage language) =>
        string.Join(' ', new[] { reads.Sleep, reads.LastFeed, reads.LastDiaper }.OfType<AssistantResult>().Select(language.Say).Distinct());

    internal static IReadOnlyList<PanelTile> Tiles(PanelReads reads, IAlexaLanguage language)
    {
        var words = language.Panel;
        return
        [
            SleepTile(reads.Sleep, language, words),
            FeedTile(reads.LastFeed, reads.NextFeed, language, words),
            DiaperTile(reads.LastDiaper, language, words),
            NapTile(reads.NextNap, language, words),
        ];
    }

    private static PanelTile SleepTile(AssistantResult? result, IAlexaLanguage language, AlexaPanelTexts words) => result switch
    {
        { Code: AssistantResultCode.Sleeping, Minutes: { } minutes } => new("sleep", words.Sleep, Compact(minutes), SinceDetail(words.AsleepSince, language, result, result.At), string.Empty),
        { Code: AssistantResultCode.Awake, At: { } since } => new("sleep", words.Sleep, Compact(MinutesBetween(since, result.AsOf)), SinceDetail(words.AwakeSince, language, result, since), string.Empty),
        _ => Empty("sleep", words.Sleep),
    };

    private static PanelTile FeedTile(AssistantResult? last, AssistantResult? next, IAlexaLanguage language, AlexaPanelTexts words)
    {
        if (last is not { Code: AssistantResultCode.LastFeed, At: { } at })
        {
            return Empty("feed", words.Feed);
        }

        var estimate = next is { Code: AssistantResultCode.NextFeed, Estimate: { } window } && language.ClockOf(next, window.Expected) is { } clock
            ? string.Format(CultureInfo.InvariantCulture, words.NextFeedEstimate, clock)
            : string.Empty;
        return LastAt("feed", words.Feed, last, at, language, words, estimate);
    }

    private static PanelTile DiaperTile(AssistantResult? last, IAlexaLanguage language, AlexaPanelTexts words) =>
        last is { Code: AssistantResultCode.LastDiaper, At: { } at } ? LastAt("diaper", words.Diaper, last, at, language, words, string.Empty) : Empty("diaper", words.Diaper);

    private static PanelTile NapTile(AssistantResult? result, IAlexaLanguage language, AlexaPanelTexts words) =>
        result is { Code: AssistantResultCode.NextNapWindow, Estimate: { } window } && language.ClockOf(result, window.Expected) is { } clock
            ? new("nap", words.Nap, clock, string.Empty, words.NapEstimate)
            : Empty("nap", words.Nap);

    /// <summary>"02:10" with "34 min ago" under it; without a known time zone the relative time is the value.</summary>
    private static PanelTile LastAt(string id, string label, AssistantResult result, DateTimeOffset at, IAlexaLanguage language, AlexaPanelTexts words, string note)
    {
        var ago = string.Format(CultureInfo.InvariantCulture, words.Ago, Compact(MinutesBetween(at, result.AsOf)));
        return language.ClockOf(result, at) is { } clock ? new(id, label, clock, ago, note) : new(id, label, ago, string.Empty, note);
    }

    private static string SinceDetail(string format, IAlexaLanguage language, AssistantResult result, DateTimeOffset? since) =>
        language.ClockOf(result, since) is { } clock ? string.Format(CultureInfo.InvariantCulture, format, clock) : string.Empty;

    private static PanelTile Empty(string id, string label) => new(id, label, Dash, string.Empty, string.Empty);

    /// <summary>"45 min", "2 h 05 min" (the same abbreviations in English and Portuguese).</summary>
    internal static string Compact(int minutes) => minutes switch
    {
        < 60 => $"{Math.Max(0, minutes)} min",
        _ when minutes % 60 == 0 => $"{minutes / 60} h",
        _ => $"{minutes / 60} h {minutes % 60:00} min",
    };

    private static int MinutesBetween(DateTimeOffset from, DateTimeOffset to) => (int)Math.Max(0, Math.Floor((to - from).TotalMinutes));

    /// <summary>The baby's name only when the user allowed it (<see cref="SpokenBaby"/>), else the app's name.</summary>
    private static string Header(PanelReads reads, IAlexaLanguage language) =>
        reads.Present.Select(SpokenBaby.NameOf).FirstOrDefault(name => name is not null) ?? language.Panel.AppName;

    private static string Clock(PanelReads reads, IAlexaLanguage language) =>
        reads.Present.Where(result => result.TimeZone is not null).Select(result => language.ClockOf(result, result.AsOf)).FirstOrDefault(clock => clock is not null) ?? string.Empty;

    private static JsonNode Json(PanelTile tile) => new JsonObject
    {
        ["id"] = tile.Id,
        ["label"] = tile.Label,
        ["value"] = tile.Value,
        ["detail"] = tile.Detail,
        ["note"] = tile.Note,
    };

    private static JsonNode LoadDocument()
    {
        using var stream = typeof(AlexaPanel).Assembly.GetManifestResourceStream(DocumentResource)
            ?? throw new InvalidOperationException($"Embedded resource {DocumentResource} is missing.");
        return JsonNode.Parse(stream)!;
    }
}
