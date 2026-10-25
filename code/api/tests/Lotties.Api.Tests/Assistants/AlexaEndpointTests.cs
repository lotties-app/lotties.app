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
    public async Task Post_EveryWriteIntent_MarksTheStoredEventViaAlexa()
    {
        var baby = await Factory.SeedBabyAsync();
        var token = host.TokenFor(baby.OwnerSubject);

        await host.PostAsync(Intent("SleepStartIntent", token, requestId: NewRequestId()), SignedHeaders);
        await host.PostAsync(Intent("BottleIntent", token, slots: new { amount = Slot("amount", "100"), volumeUnit = ResolvedSlot("volumeUnit", "ml", "ML") }, requestId: NewRequestId()), SignedHeaders);
        await host.PostAsync(Intent("DiaperIntent", token, slots: new { diaperKind = Slot("diaperKind", "wet") }, requestId: NewRequestId()), SignedHeaders);
        await host.PostAsync(Intent("NursingIntent", token, requestId: NewRequestId()), SignedHeaders);
        await host.PostAsync(Intent("SleepEndIntent", token, requestId: NewRequestId()), SignedHeaders);

        var events = await Factory.EventsAsync(baby.BabyId);
        Assert.Equal(5, events.Count);
        Assert.All(events, stored => Assert.Equal("alexa", JsonDocument.Parse(stored.Payload.Value).RootElement.GetProperty("via").GetString()));
        Assert.All(events, stored => Assert.False(JsonDocument.Parse(stored.Payload.Value).RootElement.TryGetProperty("updated_via", out _)));
    }

    [Theory]
    [InlineData("en-US", @"^I asked to delete Lia's last feed, just now\. Nothing was deleted: open the Lotties app to approve it or keep it\.$")]
    [InlineData("pt-BR", @"^Pedi para apagar o último registro de alimentação de Lia, às? \d{2}:\d{2}\. Nada foi apagado: abra o app do Lotties para aprovar ou manter\.$")]
    public async Task Post_UndoTheLastEntry_OnlyAsksAndNothingIsDeleted(string locale, string expectedPattern)
    {
        var baby = await Factory.SeedBabyAsync();
        var token = host.TokenFor(baby.OwnerSubject);
        await host.PostAsync(Intent("BottleIntent", token, slots: new { amount = Slot("amount", "100"), volumeUnit = ResolvedSlot("volumeUnit", "ml", "ML") }, requestId: NewRequestId()), SignedHeaders);

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("RequestDeleteLastIntent", token, locale, requestId: NewRequestId()), SignedHeaders));

        var stored = Assert.Single(await Factory.EventsAsync(baby.BabyId));
        Assert.Matches(expectedPattern, AlexaApiHost.Speech(json));
        Assert.Null(stored.DeletedAt);
        var payload = JsonDocument.Parse(stored.Payload.Value).RootElement;
        Assert.Equal(("alexa", "alexa"), (payload.GetProperty("via").GetString(), payload.GetProperty("delete_requested_via").GetString()));
    }

    [Fact]
    public async Task Post_UndoTheLastEntry_WithNothingMadeByVoice_SaysSo()
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("RequestDeleteLastIntent", host.TokenFor(baby.OwnerSubject)), SignedHeaders));

        Assert.Equal("I can't find an entry you logged by voice in the last 30 minutes, so nothing was changed.", AlexaApiHost.Speech(json));
    }

    [Fact]
    public async Task Post_SleepEndOfASleepTheAppStarted_AddsUpdatedViaOnly()
    {
        var baby = await Factory.SeedBabyAsync();
        var id = await Factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.SleepId, DateTimeOffset.UtcNow.AddMinutes(-30), null, """{"kind":"nap"}""");

        await host.PostAsync(Intent("SleepEndIntent", host.TokenFor(baby.OwnerSubject), requestId: NewRequestId()), SignedHeaders);

        var payload = JsonDocument.Parse((await Factory.EventAsync(id)).Payload.Value).RootElement;
        Assert.False(payload.TryGetProperty("via", out _));
        Assert.Equal("alexa", payload.GetProperty("updated_via").GetString());
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

        Assert.Equal("Please say an amount up to 16.9 ounces, for example: log a 4 ounce bottle.", AlexaApiHost.Speech(json));
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

    [Theory]
    [InlineData("NextNapWindowIntent", "I don't have enough sleep history yet to estimate Lia's next nap window.")]
    [InlineData("NextFeedIntent", "I don't have enough feeds logged yet to estimate Lia's next feed.")]
    [InlineData("NextDiaperIntent", "I don't have enough diapers logged yet to estimate Lia's next change.")]
    [InlineData("DiapersAverageIntent", "I need at least 3 complete days of diapers in the last week to give an average, and I found 0.")]
    [InlineData("BottleAverageIntent", "There aren't enough bottles with an amount logged in the last 14 days: I need at least 3, and I found 0.")]
    [InlineData("SleepTodayIntent", "Lia has no sleep logged today.")]
    [InlineData("LastDiaperIntent", "I can't find a diaper for Lia in the last 30 days.")]
    public async Task Post_NewReads_WithoutHistory_SaySoInEnglish(string intent, string expected)
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent(intent, host.TokenFor(baby.OwnerSubject)), SignedHeaders));

        Assert.Equal(expected, AlexaApiHost.Speech(json));
        Assert.True(json.GetProperty("response").GetProperty("shouldEndSession").GetBoolean());
    }

    [Theory]
    [InlineData("NextNapWindowIntent", "Ainda não tenho histórico de sono suficiente para estimar a próxima janela de sono de Lia.")]
    [InlineData("NextFeedIntent", "Ainda não tenho mamadas registradas o bastante para estimar a próxima mamada de Lia.")]
    [InlineData("DiapersAverageIntent", "Preciso de pelo menos 3 dias completos com fraldas na última semana para dar uma média, e encontrei 0.")]
    [InlineData("SleepTodayIntent", "Não há sono registrado hoje para Lia.")]
    [InlineData("LastDiaperIntent", "Não encontrei nenhuma fralda de Lia nos últimos 30 dias.")]
    public async Task Post_NewReads_WithoutHistory_SaySoInPortuguese(string intent, string expected)
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent(intent, host.TokenFor(baby.OwnerSubject), "pt-BR"), SignedHeaders));

        Assert.Equal(expected, AlexaApiHost.Speech(json));
    }

    [Theory]
    [InlineData("en-US", "There isn't enough in the log to point at a cause. This is not a diagnosis or medical advice. Call your pediatrician or emergency services if there is a fever")]
    [InlineData("pt-BR", "Não há registros suficientes para apontar uma causa. Isto não é um diagnóstico nem orientação médica. Ligue para o pediatra ou para a emergência se houver febre")]
    public async Task Post_WhyIsSheCrying_WithoutHistory_StillGivesTheSafetySentence(string locale, string startsWith)
    {
        var baby = await Factory.SeedBabyAsync();

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("CryReasonsIntent", host.TokenFor(baby.OwnerSubject), locale), SignedHeaders));

        var speech = AlexaApiHost.Speech(json);
        Assert.StartsWith(startsWith, speech, StringComparison.Ordinal);
        Assert.EndsWith(".", speech, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Post_WhyIsSheCrying_AfterAFeedingHistory_NamesHungerWithItsFactAndTheRedFlags()
    {
        var baby = await Factory.SeedBabyAsync();
        var owner = await Factory.UserIdAsync(baby.OwnerSubject);
        var now = DateTimeOffset.UtcNow;
        await Factory.SeedAsync(context =>
        {
            context.Events.AddRange(Enumerable.Range(0, 20).Select(slot => ClinicalTestData.NewEvent(baby.BabyId, owner, BuiltInEventTypes.FeedingId, now.AddHours(-6 - (slot * 3)), now.AddHours(-6 - (slot * 3)).AddMinutes(15), """{"method":"bottle","amount_ml":120}""")));
            return Task.CompletedTask;
        });

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("CryReasonsIntent", host.TokenFor(baby.OwnerSubject)), SignedHeaders));

        var speech = AlexaApiHost.Speech(json);
        Assert.StartsWith("From what is logged for Lia: hunger looks likely: the last feed was 6 hours ago", speech, StringComparison.Ordinal);
        Assert.Contains("This is not a diagnosis or medical advice. Call your pediatrician or emergency services if there is a fever", speech, StringComparison.Ordinal);
        Assert.Contains("a bulging or stiff soft spot on the head.", speech, StringComparison.Ordinal);
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
