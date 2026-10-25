using System.Net;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Microsoft.IdentityModel.Tokens;
using static Lotties.Api.Tests.Assistants.AlexaRequests;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// <c>POST /api/v1/alexa</c> end to end: disabled by default, the body cap, the timestamp and skill id checks, account
/// linking (valid, expired, wrong audience or issuer, missing token = the LinkAccount card), intents through the real
/// command layer and database, idempotent retries, the refusals spoken for a Viewer and a Doctor, both languages, the
/// built-in intents and the per-user limit.
/// </summary>
public sealed class AlexaEndpointTests(AlexaApiHost host) : IClassFixture<AlexaApiHost>
{
    private ApiFactory Factory => host.Factory;

    [Fact]
    public async Task Post_AlexaDisabledByDefault_Is404()
    {
        using var plain = new ApiFactory();

        var response = await plain.CreateClient().PostAsync("/api/v1/alexa", new StringContent(Launch(), Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Post_LaunchWithoutAccount_WelcomesAndKeepsTheSessionOpen()
    {
        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Launch(), SignedHeaders));

        Assert.Equal("1.0", json.GetProperty("version").GetString());
        Assert.StartsWith("Welcome to Lotties", AlexaApiHost.Speech(json), StringComparison.Ordinal);
        Assert.False(json.GetProperty("response").GetProperty("shouldEndSession").GetBoolean());
        Assert.True(json.GetProperty("response").TryGetProperty("reprompt", out _));
    }

    [Fact]
    public async Task Post_SessionEnded_AnswersAnEmptyResponse()
    {
        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(SessionEnded(), SignedHeaders));

        Assert.Empty(json.GetProperty("response").EnumerateObject());
    }

    [Theory]
    [InlineData("AMAZON.HelpIntent", "You can log sleep", false)]
    [InlineData("AMAZON.StopIntent", "Goodbye.", true)]
    [InlineData("AMAZON.CancelIntent", "Goodbye.", true)]
    [InlineData("AMAZON.FallbackIntent", "Sorry, Lotties can't help with that.", false)]
    [InlineData("SetBabyHelpIntent", "To choose the baby", true)]
    [InlineData("SomethingElseIntent", "Sorry, Lotties can't help with that.", false)]
    public async Task Post_BuiltInIntents_AnswerWithoutAnAccount(string intent, string startsWith, bool endsSession)
    {
        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent(intent, token: null), SignedHeaders));

        Assert.StartsWith(startsWith, AlexaApiHost.Speech(json), StringComparison.Ordinal);
        Assert.Equal(endsSession, json.GetProperty("response").GetProperty("shouldEndSession").GetBoolean());
    }

    [Fact]
    public async Task Post_CommandWithoutAccessToken_AsksToLinkTheAccount()
    {
        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("SleepStartIntent", token: null), SignedHeaders));

        Assert.Equal("LinkAccount", json.GetProperty("response").GetProperty("card").GetProperty("type").GetString());
        Assert.Equal("Please link your Lotties account in the Alexa app to use this skill.", AlexaApiHost.Speech(json));
        Assert.True(json.GetProperty("response").GetProperty("shouldEndSession").GetBoolean());
    }

    [Fact]
    public async Task Post_CommandWithoutAccessToken_InPortuguese_AsksToLinkInPortuguese()
    {
        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("LastFeedIntent", token: null, locale: "pt-BR"), SignedHeaders));

        Assert.Equal("Vincule a sua conta do Lotties no app Alexa para usar esta skill.", AlexaApiHost.Speech(json));
    }

    public static TheoryData<string> BadTokens() => new() { "expired", "audience", "issuer", "signature", "garbage" };

    [Theory]
    [MemberData(nameof(BadTokens))]
    public async Task Post_InvalidToken_AsksToLinkTheAccountAndLogsNothing(string kind)
    {
        var baby = await Factory.SeedBabyAsync();
        using var otherKey = System.Security.Cryptography.RSA.Create(2048);
        var token = kind switch
        {
            "expired" => host.TokenFor(baby.OwnerSubject, expires: DateTimeOffset.UtcNow.AddMinutes(-10)),
            "audience" => host.TokenFor(baby.OwnerSubject, audience: "another-api"),
            "issuer" => host.TokenFor(baby.OwnerSubject, issuer: "https://id.evil.test/realms/lotties.app"),
            "signature" => host.TokenFor(baby.OwnerSubject, key: new RsaSecurityKey(otherKey) { KeyId = "test-key" }),
            _ => "not-a-jwt",
        };

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("SleepStartIntent", token), SignedHeaders));

        Assert.Equal("LinkAccount", json.GetProperty("response").GetProperty("card").GetProperty("type").GetString());
        Assert.Empty(await Factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task Post_SleepStart_LogsAsTheLinkedUserAndRetriesDoNotDuplicate()
    {
        var baby = await Factory.SeedBabyAsync();
        var body = Intent("SleepStartIntent", host.TokenFor(baby.OwnerSubject), requestId: NewRequestId());

        var first = await AlexaApiHost.ReadAsync(await host.PostAsync(body, SignedHeaders));
        var retry = await AlexaApiHost.ReadAsync(await host.PostAsync(body, SignedHeaders));

        var stored = Assert.Single(await Factory.EventsAsync(baby.BabyId));
        Assert.StartsWith("Got it. Lia fell asleep", AlexaApiHost.Speech(first), StringComparison.Ordinal);
        Assert.Equal(AlexaApiHost.Speech(first), AlexaApiHost.Speech(retry));
        Assert.Equal(BuiltInEventTypes.SleepId, stored.TypeId);
        Assert.Equal(await Factory.UserIdAsync(baby.OwnerSubject), stored.CreatedBy);
        Assert.True(first.GetProperty("response").GetProperty("shouldEndSession").GetBoolean());
    }

    [Fact]
    public async Task Post_Bottle_ResolvedKindAndAmount_IsLoggedAndConfirmed()
    {
        var baby = await Factory.SeedBabyAsync();
        var slots = new { amount = Slot("amount", "120"), bottleKind = ResolvedSlot("bottleKind", "leite materno", "BREAST_MILK") };

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("BottleIntent", host.TokenFor(baby.OwnerSubject), "pt-BR", slots), SignedHeaders));

        var bottle = Assert.Single(await Factory.EventsAsync(baby.BabyId));
        var speech = AlexaApiHost.Speech(json);
        Assert.Matches(@"^Registrei uma mamadeira de 120 ml de leite materno às? \d{2}:\d{2} para Lia\.$", speech);
        Assert.Equal("breast_milk", JsonDocument.Parse(bottle.Payload.Value).RootElement.GetProperty("bottle_feeding_type").GetString());
    }

    [Fact]
    public async Task Post_BottleWithoutAmount_AsksForTheAmountRange()
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("BottleIntent", host.TokenFor(baby.OwnerSubject), slots: new { amount = Slot("amount", "?") }), SignedHeaders));

        Assert.Equal("Please say an amount from 1 to 500 ml, for example: log a 120 ml bottle.", AlexaApiHost.Speech(json));
        Assert.Empty(await Factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task Post_DiaperSpokenValueWithoutResolution_IsMatchedBySynonym()
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("DiaperIntent", host.TokenFor(baby.OwnerSubject), slots: new { diaperKind = Slot("diaperKind", "poop") }), SignedHeaders));

        Assert.StartsWith("Logged a dirty diaper for Lia", AlexaApiHost.Speech(json), StringComparison.Ordinal);
        Assert.Single(await Factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task Post_DiaperWithoutKind_AsksWhichKind()
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("DiaperIntent", host.TokenFor(baby.OwnerSubject)), SignedHeaders));

        Assert.StartsWith("Was the diaper wet, dirty, or both?", AlexaApiHost.Speech(json), StringComparison.Ordinal);
        Assert.Empty(await Factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task Post_SleepEnd_StopsTheRunningSleep()
    {
        var baby = await Factory.SeedBabyAsync();
        await Factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.SleepId, DateTimeOffset.UtcNow.AddMinutes(-80), null, """{"kind":"nap"}""");

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("SleepEndIntent", host.TokenFor(baby.OwnerSubject)), SignedHeaders));

        Assert.Matches(@"^Lia woke up just now, after sleeping 1 hour and (19|20|21) minutes\.$", AlexaApiHost.Speech(json));
    }

    [Theory]
    [InlineData(BabyRole.Viewer, "Your role on Lia doesn't allow this. Ask the baby's owner in the app.")]
    [InlineData(BabyRole.Doctor, "Voice commands are for the baby's family. Your account can't use them here.")]
    public async Task Post_WriteAsViewerOrDoctor_SpeaksTheRefusal(BabyRole role, string expected)
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Viewer, BabyRole.Doctor);

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("SleepStartIntent", host.TokenFor(baby.SubjectOf(role))), SignedHeaders));

        Assert.Equal(expected, AlexaApiHost.Speech(json));
        Assert.Empty(await Factory.EventsAsync(baby.BabyId));
    }

    [Theory]
    [InlineData("LastFeedIntent", "I can't find a feed for Lia in the last 30 days.")]
    [InlineData("SleepStatusIntent", "I can't find a sleep for Lia in the last 30 days.")]
    [InlineData("DiapersTodayIntent", "Lia has had no diapers in the last 24 hours.")]
    [InlineData("NextAppointmentIntent", "Lia has no upcoming appointments.")]
    public async Task Post_Reads_AreSpokenInEnglish(string intent, string expected)
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent(intent, host.TokenFor(baby.OwnerSubject)), SignedHeaders));

        Assert.Equal(expected, AlexaApiHost.Speech(json));
    }

    [Fact]
    public async Task Post_DueVaccines_TellsTheScheduleFactsInPortuguese()
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("DueVaccinesIntent", host.TokenFor(baby.OwnerSubject), "pt-BR"), SignedHeaders));

        Assert.StartsWith("Pelo calendário de vacinas, Lia tem ", AlexaApiHost.Speech(json), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Post_SeveralBabies_AsksToChooseOneInTheApp()
    {
        var (subject, _) = await Factory.SeedMemberOfAsync(BabyRole.Parent, BabyRole.Parent);

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("SleepStartIntent", host.TokenFor(subject)), SignedHeaders));

        Assert.Equal("You have more than one baby in Lotties. Choose the one for voice commands in the app, in Settings, Voice assistants.", AlexaApiHost.Speech(json));
    }

    [Fact]
    public async Task Post_OldTimestamp_Is400()
    {
        var response = await host.PostAsync(Intent("AMAZON.HelpIntent", null, timestamp: DateTimeOffset.UtcNow.AddSeconds(-151)), SignedHeaders);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_FutureTimestamp_Is400()
    {
        var response = await host.PostAsync(Intent("AMAZON.HelpIntent", null, timestamp: DateTimeOffset.UtcNow.AddSeconds(200)), SignedHeaders);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_AnotherSkill_Is400()
    {
        var response = await host.PostAsync(Intent("AMAZON.HelpIntent", null, skillId: "amzn1.ask.skill.99999999-2222-3333-4444-555555555555"), SignedHeaders);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("""{"version":"1.0"}""")]
    public async Task Post_NotAnAlexaRequest_Is400(string body)
    {
        var response = await host.PostAsync(body, SignedHeaders);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_DeeplyNestedJson_Is400()
    {
        var nested = string.Concat(Enumerable.Repeat("{\"a\":", 100)) + "1" + new string('}', 100);

        var response = await host.PostAsync(nested, SignedHeaders);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_WithoutSignatureHeaders_Is400()
    {
        var response = await host.PostAsync(Launch());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_BodyOverTheCap_Is413()
    {
        var padding = new string(' ', 130 * 1024);

        var response = await host.PostAsync(Launch() + padding, SignedHeaders);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public async Task Post_OverTheUserLimit_SaysToTryAgainLater()
    {
        using var limited = AlexaApiHost.With(("RequestLimits:AssistantPermitsPerMinute", "2"));
        var baby = await limited.Factory.SeedBabyAsync();
        var token = limited.TokenFor(baby.OwnerSubject);

        await limited.PostAsync(Intent("LastFeedIntent", token), SignedHeaders);
        await limited.PostAsync(Intent("LastFeedIntent", token), SignedHeaders);
        var third = await AlexaApiHost.ReadAsync(await limited.PostAsync(Intent("LastFeedIntent", token), SignedHeaders));

        Assert.Equal("That's a lot of requests. Please try again in a minute.", AlexaApiHost.Speech(third));
    }
}
