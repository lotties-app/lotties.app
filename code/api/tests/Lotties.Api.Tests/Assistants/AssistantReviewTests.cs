using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Assistants;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Units;
using static Lotties.Api.Tests.Assistants.AssistantTestKit;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The review of the voice intents against the assistant rules: every writer carries the origin marker, is idempotent and needs a role
/// that logs; numbers are validated and read in the user's unit system; a choice is a built-in option and never what was said; "undo the
/// last thing" sees every kind of entry; the medicine reminders come from the family's registered schedule and always carry the notice.
/// </summary>
public sealed class AssistantReviewTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly (string Name, Guid TypeId, Func<IAssistantService, AssistantInvocation, Task<AssistantResult>> Run)[] Writers =
    [
        ("bath", BuiltInEventTypes.BathId, (a, i) => a.LogBathAsync(i, 36m)),
        ("tummy_time", BuiltInEventTypes.TummyTimeId, (a, i) => a.LogTummyTimeAsync(i)),
        ("belly_pain", BuiltInEventTypes.BellyPainId, (a, i) => a.LogBellyPainAsync(i, 2)),
        ("breast_pump", BuiltInEventTypes.BreastPumpId, (a, i) => a.LogBreastPumpAsync(i, 50, null)),
        ("nasal_suction", BuiltInEventTypes.NasalSuctionId, (a, i) => a.LogNasalSuctionAsync(i, "bulb", true)),
        ("belly_massage", BuiltInEventTypes.BellyMassageId, (a, i) => a.LogBellyMassageAsync(i, "gas", null)),
        ("fussy", BuiltInEventTypes.FussyId, (a, i) => a.LogFussyAsync(i, "mild", null)),
        ("nail_trim", BuiltInEventTypes.NailTrimId, (a, i) => a.LogNailTrimAsync(i, "hands")),
        ("temperature", BuiltInEventTypes.TemperatureId, (a, i) => a.LogTemperatureAsync(i, 37.4m, TemperatureUnit.Celsius, "armpit")),
        ("spit_up", BuiltInEventTypes.SpitUpId, (a, i) => a.LogSpitUpAsync(i, "spit_up", "little")),
        ("teething", BuiltInEventTypes.TeethingId, (a, i) => a.LogTeethingAsync(i, "gums_sore", null)),
        ("milestone", BuiltInEventTypes.MilestoneId, (a, i) => a.LogMilestoneAsync(i, "first_smile")),
        ("symptom", BuiltInEventTypes.SymptomId, (a, i) => a.LogSymptomAsync(i, "cough", "mild")),
        ("outdoor", BuiltInEventTypes.OutdoorId, (a, i) => a.LogOutdoorAsync(i, "park")),
        ("skin_care", BuiltInEventTypes.SkinCareId, (a, i) => a.LogSkinCareAsync(i, "moisturizer")),
    ];

    public static IEnumerable<object[]> WriterNames() => Writers.Select(writer => new object[] { writer.Name });

    private static (string Name, Guid TypeId, Func<IAssistantService, AssistantInvocation, Task<AssistantResult>> Run) Writer(string name) => Writers.Single(writer => writer.Name == name);

    [Theory]
    [MemberData(nameof(WriterNames))]
    public async Task Writer_CreatesOneEventWithTheOriginMarker_AndAReplayedRequestWritesNothingMore(string name)
    {
        var baby = await factory.SeedBabyAsync();
        var writer = Writer(name);
        var invocation = Invocation("same-request", adapter: "alexa");

        var first = await factory.RunAsAsync(baby.OwnerSubject, assistant => writer.Run(assistant, invocation));
        var replay = await factory.RunAsAsync(baby.OwnerSubject, assistant => writer.Run(assistant, invocation));
        var again = await factory.RunAsAsync(baby.OwnerSubject, assistant => writer.Run(assistant, Invocation(adapter: "alexa")));

        var stored = (await factory.EventsAsync(baby.BabyId)).Where(entry => entry.TypeId == writer.TypeId).ToArray();
        Assert.Equal(first.Code, replay.Code);
        Assert.Equal(first.Code, again.Code);
        Assert.Equal(2, stored.Length);
        Assert.All(stored, entry => Assert.Equal("alexa", PayloadOf(entry).GetProperty("via").GetString()));
        Assert.Null((await factory.EventsAsync(baby.BabyId)).FirstOrDefault(entry => entry.DeletedAt is not null));
    }

    [Theory]
    [MemberData(nameof(WriterNames))]
    public async Task Writer_ForAViewerOrADoctor_IsRefusedAndWritesNothing(string name)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var writer = Writer(name);

        var result = await factory.RunAsAsync(baby.SubjectOf(BabyRole.Viewer), assistant => writer.Run(assistant, Invocation()));

        Assert.Equal(AssistantResultCode.NotAllowed, result.Code);
        Assert.Empty((await factory.EventsAsync(baby.BabyId)).Where(entry => entry.TypeId == writer.TypeId));
    }

    [Fact]
    public async Task Temperature_IsStoredInCelsius_ReadInTheUsersSystem_AndOutOfRangeLogsNothing()
    {
        var baby = await factory.SeedBabyAsync();

        var metric = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogTemperatureAsync(Invocation(), 38.5m, null, "forehead"));
        var us = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogTemperatureAsync(Invocation(locale: "en-US"), 101.3m));
        var explicitF = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogTemperatureAsync(Invocation(locale: "pt-BR"), 100.4m, TemperatureUnit.Fahrenheit));
        var tooHigh = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogTemperatureAsync(Invocation(), 99m, TemperatureUnit.Celsius));
        var tooLowF = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogTemperatureAsync(Invocation(locale: "en-US"), 37m));
        var missing = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogTemperatureAsync(Invocation(), null));

        var values = (await factory.EventsAsync(baby.BabyId)).Select(entry => PayloadOf(entry).GetProperty("value_c").GetDecimal()).Order().ToArray();
        Assert.Equal([38m, 38.5m, 38.5m], values);
        Assert.Equal(AssistantResultCode.TemperatureLogged, metric.Code);
        Assert.Equal(UnitSystem.Us, us.Units);
        Assert.All(new[] { tooHigh, tooLowF, missing }, result => Assert.Equal((AssistantResultCode.InvalidValue, "temperature", 30, 45), (result.Code, result.Field, result.Min, result.Max)));
        Assert.Equal("Logged a temperature of 101.3 degrees for the baby just now.", AlexaLanguages.For("en-US").Say(us with { TimeZone = null }));
        Assert.Contains("Please say a temperature from 86 to 113 degrees", AlexaLanguages.For("en-US").Say(tooLowF), StringComparison.Ordinal);
    }

    [Fact]
    public async Task TemperatureAnswers_AreFactsOnly_NoJudgement()
    {
        var baby = await factory.SeedBabyAsync();
        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogTemperatureAsync(Invocation(), 41m, TemperatureUnit.Celsius));

        foreach (var text in new[] { AlexaLanguages.For("en-US").Say(result), AlexaLanguages.For("pt-BR").Say(result), McpResultText.Of(result) })
        {
            Assert.DoesNotMatch(@"(?i)fever|febre|normal|too high|alta|elevad|dangerous|call|ligue|doctor|médico|medico|emergency", text);
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(6)]
    [InlineData(null)]
    public async Task BellyPain_NeedsALevelFromOneToFive_AndNeverInventsOne(int? level)
    {
        var baby = await factory.SeedBabyAsync();

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBellyPainAsync(Invocation(), level));

        Assert.Equal((AssistantResultCode.InvalidValue, "pain_level", 1, 5), (result.Code, result.Field, result.Min, result.Max));
        Assert.Empty(await factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task BreastPump_AmountsOutsideOneToFiveHundredMl_AreRefused()
    {
        var baby = await factory.SeedBabyAsync();

        var zero = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBreastPumpAsync(Invocation(), 0, 10));
        var big = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBreastPumpAsync(Invocation(), 10, 501));
        var fine = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBreastPumpAsync(Invocation(), 120, 80));

        Assert.All(new[] { zero, big }, result => Assert.Equal(("pump_amount", 1, 500), (result.Field, result.Min, result.Max)));
        Assert.Equal(AssistantResultCode.BreastPumpStarted, fine.Code);
        Assert.Single(await factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task Bath_WaterIsReadInTheUsersSystem_AndOutOfRangeIsRefused()
    {
        var baby = await factory.SeedBabyAsync();

        var us = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBathAsync(Invocation(locale: "en-US"), 98.6m));
        var tooHot = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBathAsync(Invocation(), 80m, TemperatureUnit.Celsius));

        Assert.Equal(37m, us.TemperatureC);
        Assert.Equal(("water_temperature", AssistantResultCode.InvalidValue), (tooHot.Field, tooHot.Code));
        Assert.Single(await factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task Choices_AreBuiltInOptionsOnly_WhatWasSaidIsNeverStored()
    {
        var baby = await factory.SeedBabyAsync();

        var fussy = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogFussyAsync(Invocation(), "screaming my head off", "a long story"));
        var milestone = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogMilestoneAsync(Invocation(), "other"));
        var symptom = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSymptomAsync(Invocation(), "fever", "dreadful"));
        var teething = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogTeethingAsync(Invocation(), "gums_sore", "first_molar"));

        Assert.Equal(AssistantResultCode.FussyStarted, fussy.Code);
        Assert.Null(fussy.Intensity);
        var payloads = (await factory.EventsAsync(baby.BabyId)).ToDictionary(entry => entry.TypeId, entry => PayloadOf(entry).EnumerateObject().Select(property => property.Name).Order().ToArray());
        Assert.Equal(["via"], payloads[BuiltInEventTypes.FussyId]);
        Assert.Equal(["via"], payloads[BuiltInEventTypes.MilestoneId]);
        Assert.Equal(["via"], payloads[BuiltInEventTypes.SymptomId]);
        Assert.Equal(["stage", "via"], payloads[BuiltInEventTypes.TeethingId]);
        Assert.All(new[] { milestone, symptom, teething }, result => Assert.NotEqual(AssistantResultCode.NotAllowed, result.Code));
    }

    [Fact]
    public async Task RequestDeleteLast_SeesEveryKindOfEntry_NewestFirst()
    {
        var baby = await factory.SeedBabyAsync();
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogDiaperAsync(Invocation(adapter: "alexa"), DiaperKind.Wet));
        await Task.Delay(30);
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBathAsync(Invocation(adapter: "alexa"), null));
        await Task.Delay(30);
        var temperature = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogTemperatureAsync(Invocation(adapter: "alexa"), 37m, TemperatureUnit.Celsius));

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.RequestDeleteLastAsync(Invocation(adapter: "alexa")));

        Assert.Equal((AssistantResultCode.DeleteRequested, "temperature"), (result.Code, result.EntryType));
        var marked = Assert.Single((await factory.EventsAsync(baby.BabyId)).Where(entry => AssistantOrigin.DeleteRequestedViaOf(entry.Payload) is not null));
        Assert.Equal(BuiltInEventTypes.TemperatureId, marked.TypeId);
        Assert.Equal(AssistantResultCode.TemperatureLogged, temperature.Code);
        Assert.All(await factory.EventsAsync(baby.BabyId), entry => Assert.Null(entry.DeletedAt));
        Assert.Equal("I asked to delete the baby's last temperature reading,", AlexaLanguages.For("en-US").Say(result with { TimeZone = null }).Split(" just now")[0]);
    }

    [Fact]
    public async Task Medication_LogsADoseOfARegisteredMedicineAsSaid_WithoutComputingOrSpeakingAnAmount()
    {
        var baby = await factory.SeedBabyAsync();
        await SeedMedicineAsync(baby, "Zyrtecish", everyMinutes: 480, lastDoseHoursAgo: null);
        var logged = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogMedicationAsync(Invocation(adapter: "alexa"), "zyrtecish"));
        var unknown = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogMedicationAsync(Invocation(adapter: "alexa"), "Nothing"));
        var blank = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogMedicationAsync(Invocation(adapter: "alexa"), null));
        var early = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogMedicationAsync(Invocation(adapter: "alexa"), "Zyrtecish"));

        Assert.Equal(AssistantResultCode.MedicationLogged, logged.Code);
        Assert.Equal(AssistantResultCode.MedicationLogged, early.Code);
        Assert.Equal((AssistantResultCode.NoActivePrescription, AssistantResultCode.NoActivePrescription), (unknown.Code, blank.Code));
        var doses = (await factory.EventsAsync(baby.BabyId)).Where(entry => entry.TypeId == BuiltInEventTypes.MedicationId).ToArray();
        Assert.Equal(2, doses.Length);
        Assert.All(doses, entry => Assert.Equal("alexa", PayloadOf(entry).GetProperty("via").GetString()));
        foreach (var text in new[] { AlexaLanguages.For("en-US").Say(early), AlexaLanguages.For("pt-BR").Say(early), McpResultText.Of(early), JsonSerializer.Serialize(early) })
        {
            Assert.DoesNotContain("Zyrtecish", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("drops", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("2.5", text, StringComparison.Ordinal);
            Assert.DoesNotMatch(@"(?i)too early|safe|\bok\b|cedo|seguro|overdose|maximum|máximo", text);
        }
    }

    [Fact]
    public async Task MedicationReminder_ComesOnlyFromTheRegisteredSchedule_AndAlwaysSaysItIsNotARecommendation()
    {
        var baby = await factory.SeedBabyAsync();
        var none = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadMedicationReminderAsync(Invocation(fallbackZone: "America/Sao_Paulo")));
        await SeedMedicineAsync(baby, "Zyrtecish", everyMinutes: 240, lastDoseHoursAgo: 5);
        var due = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadMedicationReminderAsync(Invocation(fallbackZone: "America/Sao_Paulo")));
        var scheduledOnly = await SeedBabyWithDoseAsync("Nightmed", everyMinutes: 480, lastDoseHoursAgo: 1);

        Assert.Equal(AssistantResultCode.NoMedicationDue, none.Code);
        Assert.Equal((AssistantResultCode.MedicationReminder, 1), (due.Code, due.Count));
        Assert.Equal((AssistantResultCode.MedicationReminder, 0), (scheduledOnly.Code, scheduledOnly.Count));
        Assert.NotNull(scheduledOnly.At);
        foreach (var result in new[] { none, due, scheduledOnly })
        {
            Assert.Contains("These are reminders of the medicines you registered in Lotties, not recommendations from Lotties. Check the prescription, and ask your doctor or pharmacist if you have doubts.", AlexaLanguages.For("en-US").Say(result), StringComparison.Ordinal);
            Assert.Contains("São lembretes dos medicamentos que você cadastrou no Lotties, não recomendações do Lotties. Confira a receita e, em caso de dúvida, fale com o médico ou o farmacêutico.", AlexaLanguages.For("pt-BR").Say(result), StringComparison.Ordinal);
            Assert.Contains("not recommendations from Lotties", McpResultText.Of(result), StringComparison.Ordinal);
            foreach (var text in new[] { AlexaLanguages.For("en-US").Say(result), AlexaLanguages.For("pt-BR").Say(result), McpResultText.Of(result), JsonSerializer.Serialize(result) })
            {
                Assert.DoesNotContain("Zyrtecish", text, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("Nightmed", text, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("drops", text, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("2.5", text, StringComparison.Ordinal);
            }
        }
    }

    [Fact]
    public async Task MedicationReminder_AnAsNeededPrescription_HasNoReminder()
    {
        var baby = await factory.SeedBabyAsync();
        var client = factory.CreateClientFor(baby.OwnerSubject);
        var medicationId = Guid.NewGuid();
        (await client.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/medications/{medicationId}", new { name = "Asneeded", isUsual = true })).EnsureSuccessStatusCode();
        var put = await client.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/prescriptions/{Guid.NewGuid()}", new { medicationId, kind = "asNeeded", dose = new { amount = 2, unit = "drops" }, minIntervalMinutes = 240, startDate = DateTime.UtcNow.AddDays(-2).ToString("yyyy-MM-dd") });
        Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadMedicationReminderAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NoMedicationDue, result.Code);
    }

    private async Task<AssistantResult> SeedBabyWithDoseAsync(string name, int everyMinutes, int lastDoseHoursAgo)
    {
        var baby = await factory.SeedBabyAsync();
        await SeedMedicineAsync(baby, name, everyMinutes, lastDoseHoursAgo);
        return await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadMedicationReminderAsync(Invocation(fallbackZone: "America/Sao_Paulo")));
    }

    private async Task SeedMedicineAsync(SeededBaby baby, string name, int everyMinutes, int? lastDoseHoursAgo)
    {
        var client = factory.CreateClientFor(baby.OwnerSubject);
        var medicationId = Guid.NewGuid();
        (await client.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/medications/{medicationId}", new { name, isUsual = true })).EnsureSuccessStatusCode();
        var prescriptionId = Guid.NewGuid();
        var put = await client.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/prescriptions/{prescriptionId}", new { medicationId, kind = "scheduled", dose = new { amount = 2.5, unit = "drops" }, everyMinutes, startDate = DateTime.UtcNow.AddDays(-3).ToString("yyyy-MM-dd") });
        Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());
        if (lastDoseHoursAgo is { } hours)
        {
            var at = DateTimeOffset.UtcNow.AddHours(-hours);
            var payload = $$"""{"medications":[{"medicationId":"{{medicationId}}","name":"{{name}}","prescriptionId":"{{prescriptionId}}"}]}""";
            await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.MedicationId, at, at, payload);
        }
    }

    [Fact]
    public void NoRendering_OfAnyResultCode_SaysAJudgementOrAdvice()
    {
        foreach (var locale in new[] { "en-US", "pt-BR" })
        {
            foreach (var code in new[] { AssistantResultCode.TemperatureLogged, AssistantResultCode.SymptomLogged, AssistantResultCode.BellyPainLogged, AssistantResultCode.FussyStarted, AssistantResultCode.SpitUpLogged, AssistantResultCode.MedicationLogged })
            {
                var text = AlexaLanguages.For(locale).Say(AlexaSpeechTests.Full(code, "America/Sao_Paulo") with { Intensity = "3", TemperatureC = 39m, Medicine = null });
                Assert.DoesNotMatch(@"(?i)fever|febre|normal|anormal|too |demais|serious|grave|should|deve |try |tente|call |ligue|diagnos|dehydrat|desidrat|safe|seguro", text);
            }
        }
    }
}
