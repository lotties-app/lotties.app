using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Microsoft.AspNetCore.Mvc.Testing;
using static Lotties.Api.Tests.Support.ClinicalTestData;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// <c>GET /babies/{id}/clinical-summary</c> and <c>GET /babies/{id}/timeline</c> (docs/design/16-doctor-access.md): sections
/// filtered by the caller's scopes, the numbers of the parents' Insights for a seeded scenario, the validation of the range and
/// the timeline's overlap rule. The server clock is fixed at 2026-01-10 12:00 UTC = 09:00 in São Paulo.
/// </summary>
public sealed class ClinicalSummaryEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly WebApplicationFactory<Program> _host = factory.WithFixedClock();

    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private static string SummaryPath(Guid babyId, string from = "2026-01-08", string to = "2026-01-10", string? query = null) =>
        $"{BabyPath(babyId)}/clinical-summary?from={from}&to={to}&{query ?? ZoneQuery}";

    private HttpClient As(SeededBaby baby, BabyRole role) => _host.ClientFor(baby.SubjectOf(role));

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.ReadAsync<JsonElement>();

    private async Task<JsonElement> SummaryAsync(SeededBaby baby, BabyRole role, string from = "2026-01-08", string to = "2026-01-10") =>
        await JsonAsync(await As(baby, role).GetAsync(SummaryPath(baby.BabyId, from, to)));

    private static bool IsNull(JsonElement element, string property) => element.GetProperty(property).ValueKind == JsonValueKind.Null;

    /// <summary>The ids in the order the database sorts them: by start, then by the id's canonical text (not .NET's <see cref="Guid"/> order).</summary>
    private static Guid[] ByStartThenId(IEnumerable<Event> events) =>
        events.OrderBy(item => item.StartedAt).ThenBy(item => item.Id.ToString(), StringComparer.OrdinalIgnoreCase).Select(item => item.Id).ToArray();

    private async Task<(SeededBaby Baby, Guid OwnerId)> GoldenBabyAsync(params BabyRole[] members)
    {
        var baby = await factory.SeedBabyAsync(members);
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        await factory.SeedGoldenDailyLogAsync(baby.BabyId, ownerId);
        return (baby, ownerId);
    }

    [Fact]
    public async Task Summary_GoldenScenario_SleepEqualsTheParentsInsights()
    {
        var (baby, _) = await GoldenBabyAsync();

        var summary = await SummaryAsync(baby, BabyRole.Owner);

        Assert.Equal(("2026-01-08", "2026-01-10", "2026-01-10", "America/Sao_Paulo"), (summary.GetProperty("from").GetString(), summary.GetProperty("to").GetString(), summary.GetProperty("today").GetString(), summary.GetProperty("timeZone").GetString()));
        Assert.Equal(baby.BabyId, summary.GetProperty("babyId").GetGuid());
        Assert.Equal(TestUsers.Now, summary.GetProperty("generatedAt").GetDateTimeOffset());
        var sleep = summary.GetProperty("sleep");
        var days = sleep.GetProperty("days").EnumerateArray().Select(day => (day.GetProperty("date").GetString(), day.GetProperty("totalMinutes").GetInt32(), day.GetProperty("nightMinutes").GetInt32(), day.GetProperty("napMinutes").GetInt32(), day.GetProperty("naps").GetInt32(), day.GetProperty("longestMinutes").GetInt32())).ToArray();
        Assert.Equal(
            [("2026-01-08", 180, 180, 0, 0, 570), ("2026-01-09", 660, 570, 90, 1, 540), ("2026-01-10", 420, 360, 60, 1, 60)],
            days);
        Assert.Equal((420, 375, 45, 0.5, 2), (sleep.GetProperty("averageTotalMinutes").GetInt32(), sleep.GetProperty("averageNightMinutes").GetInt32(), sleep.GetProperty("averageNapMinutes").GetInt32(), sleep.GetProperty("napsPerDay").GetDouble(), sleep.GetProperty("daysCounted").GetInt32()));
        Assert.Equal(570, sleep.GetProperty("longestStretchMinutes").GetInt32());
        Assert.Equal(Local(8, 21), sleep.GetProperty("longestStretchStartedAt").GetDateTimeOffset());
        Assert.Equal(("21:00", "06:15"), (sleep.GetProperty("bedtimeMedian").GetString(), sleep.GetProperty("wakeMedian").GetString()));
    }

    [Fact]
    public async Task Summary_GoldenScenario_FeedingEqualsTheParentsInsights()
    {
        var (baby, _) = await GoldenBabyAsync();

        var feeding = (await SummaryAsync(baby, BabyRole.Owner)).GetProperty("feeding");

        var days = feeding.GetProperty("days").EnumerateArray().Select(day => (day.GetProperty("date").GetString(), day.GetProperty("feeds").GetInt32(), day.GetProperty("bottleMl").GetDouble(), day.GetProperty("breast").GetInt32(), day.GetProperty("bottle").GetInt32(), day.GetProperty("solid").GetInt32())).ToArray();
        Assert.Equal([("2026-01-08", 3, 210d, 1, 2, 0), ("2026-01-09", 3, 60d, 0, 2, 1), ("2026-01-10", 1, 0d, 1, 0, 0)], days);
        Assert.Equal((3d, 315, 135d), (feeding.GetProperty("feedsPerDay").GetDouble(), feeding.GetProperty("averageIntervalMinutes").GetInt32(), feeding.GetProperty("bottleMlPerDay").GetDouble()));
        Assert.Equal((2, 4, 1), (feeding.GetProperty("breastCount").GetInt32(), feeding.GetProperty("bottleCount").GetInt32(), feeding.GetProperty("solidCount").GetInt32()));
        var formulas = feeding.GetProperty("formulas").EnumerateArray().ToArray();
        Assert.Equal(2, formulas.Length);
        Assert.Equal((AptamilId, "Aptamil", 2, 210d), (formulas[0].GetProperty("formulaId").GetGuid(), formulas[0].GetProperty("name").GetString(), formulas[0].GetProperty("feeds").GetInt32(), formulas[0].GetProperty("ml").GetDouble()));
        Assert.True(IsNull(formulas[1], "formulaId"));
        Assert.Equal(("Nan", 1, 0d), (formulas[1].GetProperty("name").GetString(), formulas[1].GetProperty("feeds").GetInt32(), formulas[1].GetProperty("ml").GetDouble()));
    }

    [Fact]
    public async Task Summary_GoldenScenario_DiapersEqualTheParentsInsights()
    {
        var (baby, _) = await GoldenBabyAsync();

        var diapers = (await SummaryAsync(baby, BabyRole.Owner)).GetProperty("diapers");

        var days = diapers.GetProperty("days").EnumerateArray().Select(day => (day.GetProperty("date").GetString(), day.GetProperty("total").GetInt32(), day.GetProperty("wet").GetInt32(), day.GetProperty("dirty").GetInt32())).ToArray();
        Assert.Equal([("2026-01-08", 1, 1, 0), ("2026-01-09", 3, 2, 2), ("2026-01-10", 1, 1, 0)], days);
        Assert.Equal((2d, 1.5d, 1d), (diapers.GetProperty("perDay").GetDouble(), diapers.GetProperty("wetPerDay").GetDouble(), diapers.GetProperty("dirtyPerDay").GetDouble()));
    }

    [Fact]
    public async Task Summary_WithoutATimeZoneName_UsesTheUtcOffsetAndReportsNoZone()
    {
        var (baby, _) = await GoldenBabyAsync();

        var response = await As(baby, BabyRole.Owner).GetAsync(SummaryPath(baby.BabyId, query: "utcOffsetMinutes=-180"));
        var summary = await JsonAsync(response);

        Assert.True(IsNull(summary, "timeZone"));
        Assert.Equal(660, summary.GetProperty("sleep").GetProperty("days")[1].GetProperty("totalMinutes").GetInt32());
    }

    [Fact]
    public async Task Summary_ADifferentZone_CutsTheDaysThere()
    {
        var (baby, _) = await GoldenBabyAsync();

        var tokyo = await JsonAsync(await As(baby, BabyRole.Owner).GetAsync(SummaryPath(baby.BabyId, query: "timeZone=Asia/Tokyo")));

        // 9 January in Tokyo is 8 January 15:00Z to 9 January 15:00Z: it holds the first night (570 min) but not the nap at 16:00Z.
        Assert.Equal("Asia/Tokyo", tokyo.GetProperty("timeZone").GetString());
        Assert.Equal(570, tokyo.GetProperty("sleep").GetProperty("days")[1].GetProperty("totalMinutes").GetInt32());
    }

    [Theory]
    [InlineData(DoctorScope.DailyLog, "sleep,feeding,diapers,symptoms")]
    [InlineData(DoctorScope.Growth, "growth")]
    [InlineData(DoctorScope.Medications, "medications")]
    [InlineData(DoctorScope.Vaccines, "vaccines")]
    [InlineData(DoctorScope.Formulas, "formulas")]
    [InlineData(DoctorScope.Notes, "")]
    public async Task Summary_DoctorWithOneScope_GetsOnlyItsSections(DoctorScope scope, string sections)
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.Create([scope]), BabyRole.Doctor);

        var summary = await SummaryAsync(baby, BabyRole.Doctor);

        var expected = sections.Split(',', StringSplitOptions.RemoveEmptyEntries);
        var present = new[] { "sleep", "feeding", "diapers", "symptoms", "medications", "vaccines", "growth", "formulas" }.Where(section => !IsNull(summary, section)).ToArray();
        Assert.Equal(expected.Order(), present.Order());
        Assert.Equal([DoctorScopes.CodeOf(scope)], summary.GetProperty("scopes").EnumerateArray().Select(code => code.GetString()).ToArray());
    }

    [Fact]
    public async Task Summary_DoctorWithNoScope_GetsNoSectionButStillAnswers()
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.None, BabyRole.Doctor);

        var summary = await SummaryAsync(baby, BabyRole.Doctor);

        Assert.Equal(0, summary.GetProperty("scopes").GetArrayLength());
        Assert.All(new[] { "sleep", "feeding", "diapers", "symptoms", "medications", "vaccines", "growth", "formulas" }, section => Assert.True(IsNull(summary, section), section));
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public async Task Summary_MembersWhoAreNotDoctors_SeeEverySection(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer);

        var summary = await SummaryAsync(baby, role);

        Assert.Equal(["daily_log", "growth", "medications", "vaccines", "formulas", "notes"], summary.GetProperty("scopes").EnumerateArray().Select(code => code.GetString()).ToArray());
        Assert.All(new[] { "sleep", "feeding", "diapers", "symptoms", "medications", "vaccines", "growth", "formulas" }, section => Assert.False(IsNull(summary, section), section));
    }

    [Fact]
    public async Task Summary_NonMember_Is403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await _host.ClientFor(TestUsers.NewSubject()).GetAsync(SummaryPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Summary_BabyWithNothingLogged_HasEmptySectionsNotNullOnes()
    {
        var baby = await factory.SeedBabyAsync();

        var summary = await SummaryAsync(baby, BabyRole.Owner);

        var sleep = summary.GetProperty("sleep");
        Assert.Equal(3, sleep.GetProperty("days").GetArrayLength());
        Assert.Equal(0, sleep.GetProperty("daysCounted").GetInt32());
        Assert.All(new[] { "averageTotalMinutes", "averageNightMinutes", "averageNapMinutes", "napsPerDay", "longestStretchMinutes", "longestStretchStartedAt", "bedtimeMedian", "wakeMedian" }, name => Assert.True(IsNull(sleep, name), name));
        Assert.True(IsNull(summary.GetProperty("feeding"), "feedsPerDay"));
        Assert.Equal(0, summary.GetProperty("feeding").GetProperty("formulas").GetArrayLength());
        Assert.True(IsNull(summary.GetProperty("diapers"), "perDay"));
        Assert.Equal(0, summary.GetProperty("symptoms").GetProperty("items").GetArrayLength());
        Assert.Equal(0, summary.GetProperty("medications").GetProperty("doses").GetArrayLength());
        Assert.Equal(0, summary.GetProperty("medications").GetProperty("activePrescriptions").GetArrayLength());
        Assert.Equal(0, summary.GetProperty("growth").GetProperty("measurements").GetArrayLength());
        Assert.True(IsNull(summary.GetProperty("formulas"), "current"));
        Assert.Equal(0, summary.GetProperty("formulas").GetProperty("history").GetArrayLength());
    }

    [Theory]
    [InlineData(null, "2026-01-10", "from")]
    [InlineData("2026-01-08", null, "to")]
    [InlineData("", "2026-01-10", "from")]
    [InlineData("08-01-2026", "2026-01-10", "from")]
    [InlineData("2026-01-08", "tomorrow", "to")]
    [InlineData("2026-01-10", "2026-01-09", "to")]
    [InlineData("2026-01-01", "2026-04-03", "to")]
    [InlineData("1999-12-31", "2026-01-10", "from")]
    public async Task Summary_InvalidRange_Is400ValidationFailedNamingTheField(string? from, string? to, string field)
    {
        var baby = await factory.SeedBabyAsync();
        var query = string.Join('&', new[] { from is null ? null : $"from={from}", to is null ? null : $"to={to}" }.OfType<string>());

        var response = await As(baby, BabyRole.Owner).GetAsync($"{BabyPath(baby.BabyId)}/clinical-summary?{query}");

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Summary_Exactly92Days_IsAccepted()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).GetAsync(SummaryPath(baby.BabyId, "2025-10-11", "2026-01-10"));

        Assert.Equal(92, (await JsonAsync(response)).GetProperty("sleep").GetProperty("days").GetArrayLength());
    }

    [Theory]
    [InlineData(-841)]
    [InlineData(841)]
    public async Task Summary_UtcOffsetOutOfRange_Is400(int offsetMinutes)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).GetAsync(SummaryPath(baby.BabyId, query: $"utcOffsetMinutes={offsetMinutes}"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Summary_Symptoms_AreTheRightTypesInTheRangeNewestFirstWithoutDeletedOnes()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var deleted = NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.TemperatureId, Local(9, 7), Local(9, 7), """{"value_c":39.9}""");
        deleted.SoftDelete(TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.TemperatureId, Local(9, 8), Local(9, 8), """{"value_c":38.4,"method":"armpit"}"""),
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.SymptomId, Local(10, 7), Local(10, 7), """{"symptom":"cough","severity":"mild"}"""),
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.SpitUpId, Local(8, 12), Local(8, 12), """{"kind":"spit_up","amount":"little"}"""),
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.BellyPainId, Local(8, 20), Local(8, 20, 30), """{"intensity":3}"""),
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.TeethingId, Local(9, 18), Local(9, 18), """{"stage":"gums_sore"}"""),
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.TemperatureId, Local(7, 23, 59), Local(7, 23, 59), """{"value_c":37.0}"""),
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.DiaperId, Local(9, 9), Local(9, 9), """{"content":"WET"}"""),
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.FussyId, Local(9, 10), Local(9, 10)),
                deleted);
            return Task.CompletedTask;
        });

        var items = (await SummaryAsync(baby, BabyRole.Owner)).GetProperty("symptoms").GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(
            [Local(10, 7), Local(9, 18), Local(9, 8), Local(8, 20), Local(8, 12)],
            items.Select(item => item.GetProperty("startedAt").GetDateTimeOffset()).ToArray());
        Assert.Equal("cough", items[0].GetProperty("payload").GetProperty("symptom").GetString());
        Assert.Equal(38.4, items[2].GetProperty("payload").GetProperty("value_c").GetDouble());
        Assert.Equal(BuiltInEventTypes.TemperatureId, items[2].GetProperty("typeId").GetGuid());
    }

    [Fact]
    public async Task Summary_Symptoms_AreCappedAt200()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var temperatures = Enumerable.Range(0, 205).Select(minute => NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.TemperatureId, Local(9, 0).AddMinutes(minute), Local(9, 0).AddMinutes(minute), """{"value_c":37.5}""")).ToArray();
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(temperatures);
            return Task.CompletedTask;
        });

        var items = (await SummaryAsync(baby, BabyRole.Owner)).GetProperty("symptoms").GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(200, items.Length);
        Assert.Equal(Local(9, 0).AddMinutes(204), items[0].GetProperty("startedAt").GetDateTimeOffset());
        Assert.Equal(Local(9, 0).AddMinutes(5), items[^1].GetProperty("startedAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Summary_Medications_CountsTheDosesGivenInTheRangePerMedicationAndListsTheActivePrescriptions()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var parent = As(baby, BabyRole.Parent);
        var colidis = Guid.NewGuid();
        var vitamin = Guid.NewGuid();
        await parent.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/medications/{colidis}", new { name = "Colidis", isUsual = true });
        var prescriptionId = Guid.NewGuid();
        var created = await parent.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/prescriptions/{prescriptionId}", new
        {
            medicationId = colidis,
            kind = "asNeeded",
            dose = new { amount = 2, unit = "drops" },
            minIntervalMinutes = 480,
            maxDosesPer24h = 3,
            indication = "belly pain",
            startDate = "2026-01-01",
            prescriber = "Dr. Ana",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.MedicationId, Local(9, 8), Local(9, 8), $$"""{"medications":[{"medicationId":"{{colidis}}","name":"Colidis"}]}"""),
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.MedicationId, Local(10, 8), Local(10, 8), $$"""{"medications":[{"medicationId":"{{colidis}}","name":"Colidis 2 gotas"},{"medicationId":"{{vitamin}}","name":"Vitamin D"}]}"""),
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.MedicationId, Local(7, 8), Local(7, 8), $$"""{"medications":[{"medicationId":"{{vitamin}}","name":"Vitamin D"}]}"""));
            return Task.CompletedTask;
        });

        var medications = (await SummaryAsync(baby, BabyRole.Owner)).GetProperty("medications");

        var doses = medications.GetProperty("doses").EnumerateArray().ToArray();
        Assert.Equal(2, doses.Length);
        Assert.Equal((colidis, "Colidis 2 gotas", 2, Local(10, 8)), (doses[0].GetProperty("medicationId").GetGuid(), doses[0].GetProperty("name").GetString(), doses[0].GetProperty("count").GetInt32(), doses[0].GetProperty("lastGivenAt").GetDateTimeOffset()));
        Assert.Equal((vitamin, 1), (doses[1].GetProperty("medicationId").GetGuid(), doses[1].GetProperty("count").GetInt32()));
        var prescription = Assert.Single(medications.GetProperty("activePrescriptions").EnumerateArray());
        Assert.Equal((prescriptionId, "asNeeded", "belly pain"), (prescription.GetProperty("id").GetGuid(), prescription.GetProperty("kind").GetString(), prescription.GetProperty("indication").GetString()));
        Assert.True(IsNull(prescription, "prescribedByUserId"));
    }

    [Fact]
    public async Task Summary_Medications_AnActivePrescriptionFromADoctorCarriesItsProvenance()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Doctor);
        var doctor = As(baby, BabyRole.Doctor);
        await doctor.PutAsJsonAsync("/api/v1/me/professional-profile", new { displayName = "Ana Souza", specialty = "Pediatrics", shareDisplayName = true, shareRegistration = true });
        var proposalId = Guid.NewGuid();
        var proposed = await doctor.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/prescription-proposals/{proposalId}", new
        {
            medicationName = "Paracetamol drops",
            kind = "scheduled",
            dose = new { amount = 2, unit = "drops" },
            timesOfDay = new[] { "08:00", "20:00" },
            startDate = "2026-01-05",
            endDate = "2026-01-20",
            instructions = "After the feed.",
        });
        Assert.Equal(HttpStatusCode.Created, proposed.StatusCode);
        var accepted = await As(baby, BabyRole.Parent).PostAsJsonAsync($"{BabyPath(baby.BabyId)}/prescription-proposals/{proposalId}/accept", new { prescriptionId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);

        var summary = await JsonAsync(await doctor.GetAsync($"{BabyPath(baby.BabyId)}/clinical-summary?from=2026-01-08&to=2026-01-10&{ZoneQuery}"));

        var prescription = Assert.Single(summary.GetProperty("medications").GetProperty("activePrescriptions").EnumerateArray());
        Assert.Equal(("Ana Souza", proposalId, false), (prescription.GetProperty("prescribedByName").GetString(), prescription.GetProperty("proposalId").GetGuid(), prescription.GetProperty("changedByParent").GetBoolean()));
        Assert.Equal("Ana Souza", prescription.GetProperty("prescribedBy").GetProperty("displayName").GetString());
        Assert.Equal("Paracetamol drops", prescription.GetProperty("original").GetProperty("medicationName").GetString());
    }

    [Fact]
    public async Task Summary_Vaccines_CountsTheScheduleToday_AndARecordedDoseLeavesTheDueList()
    {
        var baby = await factory.SeedBabyAsync();
        var before = (await SummaryAsync(baby, BabyRole.Owner)).GetProperty("vaccines");
        var dueDoses = before.GetProperty("dueDoses").EnumerateArray().ToArray();
        Assert.NotEmpty(dueDoses);
        var first = dueDoses[0];
        Assert.Equal(before.GetProperty("due").GetInt32() + before.GetProperty("overdue").GetInt32(), dueDoses.Length);
        Assert.Contains(first.GetProperty("state").GetString(), new[] { "due", "overdue" });
        Assert.Equal("2026-01-10", first.GetProperty("dueOn").GetString());
        Assert.False(string.IsNullOrEmpty(first.GetProperty("vaccineNames").GetProperty("en").GetString()));
        Assert.False(string.IsNullOrEmpty(first.GetProperty("vaccineNames").GetProperty("pt-BR").GetString()));
        Assert.False(string.IsNullOrEmpty(first.GetProperty("doseLabel").GetProperty("en").GetString()));
        Assert.False(string.IsNullOrEmpty(first.GetProperty("vaccineKey").GetString()));

        var recorded = await As(baby, BabyRole.Owner).PutAsJsonAsync($"{BabyPath(baby.BabyId)}/vaccinations/{Guid.NewGuid()}", new
        {
            vaccineKey = first.GetProperty("vaccineKey").GetString(),
            doseId = first.GetProperty("doseId").GetString(),
            givenOn = "2026-01-10",
            network = "public",
        });
        Assert.Equal(HttpStatusCode.Created, recorded.StatusCode);
        var after = (await SummaryAsync(baby, BabyRole.Owner)).GetProperty("vaccines");

        Assert.True(after.GetProperty("given").GetInt32() > before.GetProperty("given").GetInt32());
        Assert.DoesNotContain(first.GetProperty("doseId").GetString(), after.GetProperty("dueDoses").EnumerateArray().Select(dose => dose.GetProperty("doseId").GetString()));
    }

    [Fact]
    public async Task Summary_Growth_ListsEveryMeasurementOldestDateFirst()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var parent = As(baby, BabyRole.Parent);
        foreach (var (date, weight) in new[] { ("2026-01-05", 5.0m), ("2026-01-09", 5.4m), ("2025-12-20", 4.2m) })
        {
            var response = await parent.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/measurements/{Guid.NewGuid()}", new { date, weightKg = weight });
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        }

        var growth = (await SummaryAsync(baby, BabyRole.Owner)).GetProperty("growth").GetProperty("measurements");

        Assert.Equal(["2025-12-20", "2026-01-05", "2026-01-09"], growth.EnumerateArray().Select(item => item.GetProperty("date").GetString()).ToArray());
        Assert.Equal(4.2m, growth[0].GetProperty("weightKg").GetDecimal());
    }

    [Fact]
    public async Task Summary_Formulas_HasTheCurrentOneAndTheHistoryNewestFirst()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var parent = As(baby, BabyRole.Parent);
        var older = Guid.NewGuid();
        var newer = Guid.NewGuid();
        await parent.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/formulas/{older}", new { name = "Nan 1", startedOn = "2025-11-01", isCurrent = false, archived = true });
        await parent.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/formulas/{newer}", new { name = "Aptamil 2", startedOn = "2026-01-02", isCurrent = true, archived = false });

        var formulas = (await SummaryAsync(baby, BabyRole.Owner)).GetProperty("formulas");

        Assert.Equal(newer, formulas.GetProperty("current").GetProperty("id").GetGuid());
        Assert.Equal([newer, older], formulas.GetProperty("history").EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray());
    }

    [Fact]
    public async Task Timeline_ReturnsTheNonDeletedEventsOverlappingTheRangeByStartThenId()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var from = Local(9, 0);
        var to = Local(10, 0);
        var deleted = NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.DiaperId, Local(9, 12), Local(9, 12));
        deleted.SoftDelete(TestUsers.Now);
        var included = new[]
        {
            NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.SleepId, Local(7, 8), null, """{"kind":"night"}"""),
            NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.SleepId, Local(8, 23), Local(9, 1), """{"kind":"night"}"""),
            NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.DiaperId, from, from, """{"content":"WET"}"""),
            NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.FeedingId, Local(9, 10), Local(9, 10, 15), """{"method":"breast"}"""),
            NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.SleepId, Local(9, 23, 30), Local(10, 1), """{"kind":"night"}"""),
        };
        var excluded = new[]
        {
            NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.SleepId, Local(8, 22), Local(8, 23), """{"kind":"nap"}"""),
            NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.SleepId, Local(8, 23), Local(9, 0), """{"kind":"nap"}"""),
            NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.DiaperId, to, to, """{"content":"WET"}"""),
            deleted,
        };
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(included);
            context.Events.AddRange(excluded);
            return Task.CompletedTask;
        });

        var response = await As(baby, BabyRole.Owner).GetAsync($"{BabyPath(baby.BabyId)}/timeline?from={Uri.EscapeDataString(from.UtcDateTime.ToString("O"))}&to={Uri.EscapeDataString(to.UtcDateTime.ToString("O"))}");

        var ids = (await JsonAsync(response)).EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        Assert.Equal(ByStartThenId(included), ids);
    }

    [Fact]
    public async Task Timeline_SameStart_IsOrderedById()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var twins = new[]
        {
            NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.DiaperId, Local(9, 8), Local(9, 8), """{"content":"WET"}"""),
            NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.DiaperId, Local(9, 8), Local(9, 8), """{"content":"DIRTY"}"""),
            NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.DiaperId, Local(9, 8), Local(9, 8), """{"content":"MIXED"}"""),
        };
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(twins);
            return Task.CompletedTask;
        });

        var response = await As(baby, BabyRole.Owner).GetAsync($"{BabyPath(baby.BabyId)}/timeline?from=2026-01-09T03:00:00Z&to=2026-01-10T03:00:00Z");

        var ids = (await JsonAsync(response)).EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        Assert.Equal(ByStartThenId(twins), ids);
    }

    [Fact]
    public async Task Timeline_EventsAreTheFullEventRepresentationWithThePayload()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var feed = NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.FeedingId, Local(9, 8), Local(9, 8, 20), """{"method":"bottle","amount_ml":120}""");
        await factory.SeedAsync(context =>
        {
            context.Events.Add(feed);
            return Task.CompletedTask;
        });

        var response = await As(baby, BabyRole.Owner).GetAsync($"{BabyPath(baby.BabyId)}/timeline?from=2026-01-09T03:00:00Z&to=2026-01-10T03:00:00Z");

        var item = Assert.Single((await JsonAsync(response)).EnumerateArray());
        Assert.Equal((feed.Id, BuiltInEventTypes.FeedingId, 120), (item.GetProperty("id").GetGuid(), item.GetProperty("typeId").GetGuid(), item.GetProperty("payload").GetProperty("amount_ml").GetInt32()));
        Assert.Equal(Local(9, 8, 20), item.GetProperty("endedAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Timeline_ReturnsAtMost2000Events()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var many = Enumerable.Range(0, 2005).Select(second => NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.DiaperId, Local(9, 0).AddSeconds(second), Local(9, 0).AddSeconds(second), """{"content":"WET"}""")).ToArray();
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(many);
            return Task.CompletedTask;
        });

        var response = await As(baby, BabyRole.Owner).GetAsync($"{BabyPath(baby.BabyId)}/timeline?from=2026-01-09T03:00:00Z&to=2026-01-10T03:00:00Z");

        var items = (await JsonAsync(response)).EnumerateArray().ToArray();
        Assert.Equal(2000, items.Length);
        Assert.Equal(Local(9, 0), items[0].GetProperty("startedAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Timeline_EightDays_IsAccepted_MoreIs400()
    {
        var baby = await factory.SeedBabyAsync();
        var owner = As(baby, BabyRole.Owner);

        var ok = await owner.GetAsync($"{BabyPath(baby.BabyId)}/timeline?from=2026-01-01T00:00:00Z&to=2026-01-09T00:00:00Z");
        var tooLong = await owner.GetAsync($"{BabyPath(baby.BabyId)}/timeline?from=2026-01-01T00:00:00Z&to=2026-01-09T00:00:01Z");

        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var problem = await tooLong.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("to", problem.GetProperty("field").GetString());
    }

    [Theory]
    [InlineData("from=2026-01-09T00:00:00Z", "to")]
    [InlineData("to=2026-01-09T00:00:00Z", "from")]
    [InlineData("from=2026-01-09T00:00:00Z&to=2026-01-09T00:00:00Z", "to")]
    [InlineData("from=2026-01-09T10:00:00Z&to=2026-01-09T09:00:00Z", "to")]
    public async Task Timeline_MissingOrReversedBounds_Is400ValidationFailed(string query, string field)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).GetAsync($"{BabyPath(baby.BabyId)}/timeline?{query}");

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Timeline_DoctorWithTheDailyLogScope_ReadsIt_WithoutItIs403()
    {
        var withScope = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.DailyLog]), BabyRole.Doctor);
        var withoutScope = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.Growth, DoctorScope.Notes]), BabyRole.Doctor);
        const string Query = "timeline?from=2026-01-09T03:00:00Z&to=2026-01-10T03:00:00Z";

        var allowed = await As(withScope, BabyRole.Doctor).GetAsync($"{BabyPath(withScope.BabyId)}/{Query}");
        var refused = await As(withoutScope, BabyRole.Doctor).GetAsync($"{BabyPath(withoutScope.BabyId)}/{Query}");

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.Forbidden), (allowed.StatusCode, refused.StatusCode));
    }
}
