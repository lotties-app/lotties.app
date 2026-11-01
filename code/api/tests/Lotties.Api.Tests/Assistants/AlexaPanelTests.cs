using System.Text.Json;
using System.Text.Json.Nodes;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using static Lotties.Api.Tests.Assistants.AlexaRequests;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The Echo Show night panel (docs/design/42-echo-show-panel.md): <c>PanelIntent</c> with and without APL, the minute refresh
/// (<c>Alexa.Presentation.APL.UserEvent</c>), account linking, the assistant limit, the baby-name rule, dashes for tiles that have
/// no fact, both languages, and the APL document itself.
/// </summary>
public sealed class AlexaPanelTests(AlexaApiHost host) : IClassFixture<AlexaApiHost>
{
    private const string Render = "Alexa.Presentation.APL.RenderDocument";
    private const string Execute = "Alexa.Presentation.APL.ExecuteCommands";

    private ApiFactory Factory => host.Factory;

    private static string Panel(string? token, string locale = "en-US", bool apl = true) =>
        Build(new { type = "IntentRequest", requestId = NewRequestId(), timestamp = Now(), locale, intent = new { name = "PanelIntent", confirmationStatus = "NONE", slots = new { } } }, token, apl);

    private static string UserEvent(string? token, string argument = "panelRefresh", string locale = "en-US") =>
        Build(new { type = "Alexa.Presentation.APL.UserEvent", requestId = NewRequestId(), timestamp = Now(), locale, arguments = new[] { argument }, source = new { type = "Document", id = "main" } }, token, true);

    private static string Now() => DateTimeOffset.UtcNow.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'");

    private static string Build(object request, string? token, bool apl)
    {
        var user = new { userId = "amzn1.ask.account.TEST", accessToken = token };
        object interfaces = apl ? new Dictionary<string, object> { ["Alexa.Presentation.APL"] = new { runtime = new { maxVersion = "2024.3" } }, ["Display"] = new { } } : new Dictionary<string, object> { ["AudioPlayer"] = new { } };
        return JsonSerializer.Serialize(new
        {
            version = "1.0",
            session = new { @new = false, sessionId = "amzn1.echo-api.session.TEST", application = new { applicationId = AlexaApiHost.SkillId }, user },
            context = new { System = new { application = new { applicationId = AlexaApiHost.SkillId }, user, device = new { deviceId = "amzn1.ask.device.TEST", supportedInterfaces = interfaces } } },
            request,
        });
    }

    private async Task<JsonElement> PostAsync(string body) => await AlexaApiHost.ReadAsync(await host.PostAsync(body, SignedHeaders));

    private static JsonElement Directive(JsonElement json) => json.GetProperty("response").GetProperty("directives")[0];

    private static JsonElement Tiles(JsonElement json) => Directive(json).GetProperty("datasources").GetProperty("panelData").GetProperty("properties").GetProperty("tiles");

    private static string Tile(JsonElement json, string id, string field) => Tiles(json).EnumerateArray().Single(tile => tile.GetProperty("id").GetString() == id).GetProperty(field).GetString()!;

    private static string RepoFile(string relative)
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, relative)))
            {
                return Path.Combine(directory.FullName, relative);
            }
        }

        throw new FileNotFoundException(relative);
    }

    [Theory]
    [InlineData("en-US", "Sleep", "Feed", "Diaper", "Next nap")]
    [InlineData("pt-BR", "Sono", "Mamada", "Fralda", "Próxima janela de sono")]
    public async Task Panel_WithApl_RendersTheDarkDocumentWithFourTilesAndNoSpeech(string locale, string sleep, string feed, string diaper, string nap)
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await PostAsync(Panel(host.TokenFor(baby.OwnerSubject), locale));

        var response = json.GetProperty("response");
        Assert.False(response.TryGetProperty("outputSpeech", out _));
        Assert.False(response.TryGetProperty("reprompt", out _));
        Assert.False(response.GetProperty("shouldEndSession").GetBoolean());
        var directive = Directive(json);
        Assert.Equal(Render, directive.GetProperty("type").GetString());
        Assert.Equal("lotties-panel", directive.GetProperty("token").GetString());
        Assert.Equal("APL", directive.GetProperty("document").GetProperty("type").GetString());
        Assert.Equal(["sleep", "feed", "diaper", "nap"], Tiles(json).EnumerateArray().Select(tile => tile.GetProperty("id").GetString()));
        Assert.Equal([sleep, feed, diaper, nap], Tiles(json).EnumerateArray().Select(tile => tile.GetProperty("label").GetString()));
    }

    [Fact]
    public async Task Panel_TilesWithoutAFact_ShowADashAndNoNumber()
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await PostAsync(Panel(host.TokenFor(baby.OwnerSubject)));

        Assert.All(Tiles(json).EnumerateArray(), tile =>
        {
            Assert.Equal("—", tile.GetProperty("value").GetString());
            Assert.Equal(string.Empty, tile.GetProperty("detail").GetString());
            Assert.Equal(string.Empty, tile.GetProperty("note").GetString());
        });
    }

    [Fact]
    public async Task Panel_AfterLoggingADiaperAndSleep_ShowsThemAndKeepsTheOthersAsDashes()
    {
        var baby = await Factory.SeedBabyAsync();
        var token = host.TokenFor(baby.OwnerSubject);
        await host.PostAsync(Intent("DiaperIntent", token, slots: new { diaperKind = Slot("diaperKind", "wet") }, requestId: NewRequestId()), SignedHeaders);
        await host.PostAsync(Intent("SleepStartIntent", token, requestId: NewRequestId()), SignedHeaders);

        var json = await PostAsync(Panel(token));

        Assert.Equal("0 min ago", Tile(json, "diaper", "value"));
        Assert.Equal("0 min", Tile(json, "sleep", "value"));
        Assert.Equal("—", Tile(json, "feed", "value"));
        Assert.Equal("—", Tile(json, "nap", "value"));
    }

    [Fact]
    public async Task Panel_WithoutApl_SpeaksTheUsualAnswersAndSendsNoDirective()
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await PostAsync(Panel(host.TokenFor(baby.OwnerSubject), apl: false));

        Assert.False(json.GetProperty("response").TryGetProperty("directives", out _));
        Assert.Equal("I can't find a sleep for the baby in the last 30 days. I can't find a feed for the baby in the last 30 days. I can't find a diaper for the baby in the last 30 days.", AlexaApiHost.Speech(json));
        Assert.True(json.GetProperty("response").GetProperty("shouldEndSession").GetBoolean());
    }

    [Fact]
    public async Task Refresh_UserEvent_AnswersAFreshDocumentAndKeepsTheSessionOpen()
    {
        var baby = await Factory.SeedBabyAsync();
        var token = host.TokenFor(baby.OwnerSubject);
        var first = await PostAsync(Panel(token));
        await host.PostAsync(Intent("DiaperIntent", token, slots: new { diaperKind = Slot("diaperKind", "dirty") }, requestId: NewRequestId()), SignedHeaders);

        var refreshed = await PostAsync(UserEvent(token));

        Assert.Equal("—", Tile(first, "diaper", "value"));
        Assert.Equal("0 min ago", Tile(refreshed, "diaper", "value"));
        Assert.Equal(Render, Directive(refreshed).GetProperty("type").GetString());
        Assert.False(refreshed.GetProperty("response").GetProperty("shouldEndSession").GetBoolean());
        Assert.False(refreshed.GetProperty("response").TryGetProperty("outputSpeech", out _));
    }

    [Fact]
    public async Task UserEvent_WithAnotherArgument_AnswersAnEmptyResponse()
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await PostAsync(UserEvent(host.TokenFor(baby.OwnerSubject), argument: "something"));

        Assert.Empty(json.GetProperty("response").EnumerateObject());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Panel_WithoutALinkedAccount_AsksToLinkIt(bool refresh)
    {
        var json = await PostAsync(refresh ? UserEvent(null) : Panel(null));

        Assert.Equal("LinkAccount", json.GetProperty("response").GetProperty("card").GetProperty("type").GetString());
        Assert.False(json.GetProperty("response").TryGetProperty("directives", out _));
    }

    [Fact]
    public async Task Panel_NoBabyNameByDefault_AndTheNameOnlyWhenTheUserAllowedIt()
    {
        var baby = await Factory.SeedBabyAsync();
        var token = host.TokenFor(baby.OwnerSubject);

        var anonymous = await host.PostAsync(Panel(token), SignedHeaders);
        var anonymousText = await anonymous.Content.ReadAsStringAsync();
        var userId = await Factory.UserIdAsync(baby.OwnerSubject);
        await Factory.SeedAsync(context =>
        {
            context.UserAssistantSettings.Add(UserAssistantSettings.Create(userId, null, DateTimeOffset.UtcNow, sayBabyName: true));
            return Task.CompletedTask;
        });
        var named = await PostAsync(Panel(token));

        Assert.DoesNotContain("Lia", anonymousText, StringComparison.Ordinal);
        Assert.Contains("\"header\":\"Lotties\"", anonymousText, StringComparison.Ordinal);
        var spoken = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("SleepStatusIntent", token), SignedHeaders));
        Assert.Contains("Lia", AlexaApiHost.Speech(spoken), StringComparison.Ordinal);
        Assert.Equal("Lia", Directive(named).GetProperty("datasources").GetProperty("panelData").GetProperty("properties").GetProperty("header").GetString());
    }

    [Theory]
    [InlineData("en-US", "not updated")]
    [InlineData("pt-BR", "sem atualizar")]
    public async Task Refresh_OverTheAssistantLimit_KeepsTheScreenAndOnlyMarksItNotUpdated(string locale, string mark)
    {
        using var limited = AlexaApiHost.With(("RequestLimits:AssistantPermitsPerMinute", "1"));
        var baby = await limited.Factory.SeedBabyAsync();
        var token = limited.TokenFor(baby.OwnerSubject);
        await limited.PostAsync(Panel(token, locale), SignedHeaders);

        var json = await AlexaApiHost.ReadAsync(await limited.PostAsync(UserEvent(token, locale: locale), SignedHeaders));

        var directive = Directive(json);
        Assert.Equal(Execute, directive.GetProperty("type").GetString());
        Assert.Equal("lotties-panel", directive.GetProperty("token").GetString());
        var command = directive.GetProperty("commands")[0];
        Assert.Equal("SetValue", command.GetProperty("type").GetString());
        Assert.Equal("stale", command.GetProperty("componentId").GetString());
        Assert.Equal(mark, command.GetProperty("value").GetString());
        Assert.False(directive.TryGetProperty("document", out _));
        Assert.False(json.GetProperty("response").GetProperty("shouldEndSession").GetBoolean());
    }

    [Fact]
    public async Task Panel_IntentOverTheAssistantLimit_SpeaksTheUsualLimitSentence()
    {
        using var limited = AlexaApiHost.With(("RequestLimits:AssistantPermitsPerMinute", "1"));
        var baby = await limited.Factory.SeedBabyAsync();
        var token = limited.TokenFor(baby.OwnerSubject);
        await limited.PostAsync(Panel(token), SignedHeaders);

        var json = await AlexaApiHost.ReadAsync(await limited.PostAsync(Panel(token), SignedHeaders));

        Assert.Equal("That's a lot of requests. Please try again in a minute.", AlexaApiHost.Speech(json));
    }

    [Fact]
    public async Task Panel_ARefreshCostsOnePermitNotOnePerRead()
    {
        using var limited = AlexaApiHost.With(("RequestLimits:AssistantPermitsPerMinute", "3"));
        var baby = await limited.Factory.SeedBabyAsync();
        var token = limited.TokenFor(baby.OwnerSubject);

        var types = new List<string?>();
        foreach (var body in new[] { Panel(token), UserEvent(token), UserEvent(token) })
        {
            types.Add(Directive(await AlexaApiHost.ReadAsync(await limited.PostAsync(body, SignedHeaders))).GetProperty("type").GetString());
        }

        Assert.Equal([Render, Render, Render], types);
    }

    [Fact]
    public void Tiles_OfSuccessfulResults_ShowTheFactsAndLabelEstimates()
    {
        var asOf = new DateTimeOffset(2026, 11, 1, 5, 0, 0, TimeSpan.Zero);
        var feed = new AssistantResult { Code = AssistantResultCode.LastFeed, AsOf = asOf, At = asOf.AddMinutes(-34), TimeZone = "America/Sao_Paulo" };
        var tiles = AlexaPanel.Tiles(new PanelReads(
            new AssistantResult { Code = AssistantResultCode.Awake, AsOf = asOf, At = asOf.AddMinutes(-50), Minutes = 90, TimeZone = "America/Sao_Paulo" },
            feed,
            new AssistantResult { Code = AssistantResultCode.NextFeed, AsOf = asOf, TimeZone = "America/Sao_Paulo", Estimate = new AssistantTimeWindow(asOf.AddHours(1), asOf.AddHours(2), asOf.AddHours(3)) },
            new AssistantResult { Code = AssistantResultCode.LastDiaper, AsOf = asOf, At = asOf.AddMinutes(-125), TimeZone = "America/Sao_Paulo" },
            new AssistantResult { Code = AssistantResultCode.NextNapWindow, AsOf = asOf, TimeZone = "America/Sao_Paulo", Estimate = new AssistantTimeWindow(asOf, asOf.AddHours(1), asOf.AddHours(2)) }),
            AlexaLanguages.For("pt-BR"));

        Assert.Equal(new PanelTile("sleep", "Sono", "50 min", "acordado desde 01:10", string.Empty), tiles[0]);
        Assert.Equal(new PanelTile("feed", "Mamada", "01:26", "há 34 min", "próxima mamada 04:00 (estimativa do seu registro)"), tiles[1]);
        Assert.Equal(new PanelTile("diaper", "Fralda", "23:55", "há 2 h 05 min", string.Empty), tiles[2]);
        Assert.Equal(new PanelTile("nap", "Próxima janela de sono", "03:00", string.Empty, "estimativa do seu registro"), tiles[3]);
    }

    [Theory]
    [InlineData(AssistantResultCode.ConsentRequired)]
    [InlineData(AssistantResultCode.NoBaby)]
    [InlineData(AssistantResultCode.ChooseBaby)]
    [InlineData(AssistantResultCode.NotAllowed)]
    [InlineData(AssistantResultCode.RateLimited)]
    [InlineData(AssistantResultCode.NoFeeds)]
    [InlineData(AssistantResultCode.NoSleeps)]
    public void Tiles_OfAnyOtherResult_ShowADashNeverANumber(AssistantResultCode code)
    {
        var asOf = DateTimeOffset.UtcNow;
        var other = new AssistantResult { Code = code, AsOf = asOf, At = asOf.AddMinutes(-10), Minutes = 10, Count = 3, Estimate = new AssistantTimeWindow(asOf, asOf, asOf), TimeZone = "UTC" };

        var tiles = AlexaPanel.Tiles(new PanelReads(other, other, other, other, other), AlexaLanguages.For("en-US"));

        Assert.All(tiles, tile => Assert.Equal(new PanelTile(tile.Id, tile.Label, "—", string.Empty, string.Empty), tile));
    }

    [Fact]
    public void Tiles_WithAFailedRead_ShowADash()
    {
        Assert.All(AlexaPanel.Tiles(new PanelReads(null, null, null, null, null), AlexaLanguages.For("en-US")), tile => Assert.Equal("—", tile.Value));
    }

    [Theory]
    [InlineData(0, "0 min")]
    [InlineData(45, "45 min")]
    [InlineData(60, "1 h")]
    [InlineData(125, "2 h 05 min")]
    public void Compact_IsTheSameInBothLanguages(int minutes, string expected) => Assert.Equal(expected, AlexaPanel.Compact(minutes));

    [Fact]
    public void Document_IsWellFormed_Dark_NoAnimationNoImages_AndEqualToTheCopyUnderAlexa()
    {
        var copy = File.ReadAllText(RepoFile(Path.Combine("alexa", "apl-night-panel.json")));
        var document = JsonNode.Parse(copy)!;
        var embedded = typeof(AlexaPanel).Assembly.GetManifestResourceStream("Lotties.Api.Assistants.Alexa.Panel.panel.apl.json")!;

        Assert.True(JsonNode.DeepEquals(document, JsonNode.Parse(embedded)));
        Assert.Equal("dark", document["theme"]!.GetValue<string>());
        Assert.Equal("#050505", document["mainTemplate"]!["item"]!["backgroundColor"]!.GetValue<string>());
        var text = document.ToJsonString();
        Assert.DoesNotContain("\"Image\"", text, StringComparison.Ordinal);
        Assert.DoesNotContain("AnimateItem", text, StringComparison.Ordinal);
        Assert.DoesNotContain("\"Video\"", text, StringComparison.Ordinal);
        Assert.Contains("panelRefresh", text, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void PanelIntent_IsAKnownReadIntentWithSamplesInTheModel(string locale)
    {
        var model = JsonNode.Parse(File.ReadAllText(RepoFile(Path.Combine("alexa", $"interaction-model.{locale}.json"))))!;
        var intent = model["interactionModel"]!["languageModel"]!["intents"]!.AsArray().Single(candidate => candidate!["name"]!.GetValue<string>() == "PanelIntent")!;

        Assert.Contains("PanelIntent", AlexaSkill.KnownIntents);
        Assert.DoesNotContain("PanelIntent", AlexaSkill.WriteIntents);
        Assert.NotEmpty(intent["samples"]!.AsArray());
        Assert.Empty(intent["slots"]!.AsArray());
    }
}
