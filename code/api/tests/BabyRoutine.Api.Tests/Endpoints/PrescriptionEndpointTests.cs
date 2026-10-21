using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.EventTypes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BabyRoutine.Api.Tests.Endpoints;

public sealed class PrescriptionEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private static string PrescriptionPath(Guid babyId, Guid prescriptionId) => $"{BabyPath(babyId)}/prescriptions/{prescriptionId}";

    private static object AsNeeded(Guid medicationId, int minIntervalMinutes = 480, string? group = null, object? dose = null, string startDate = "2026-01-01", object? updatedAt = null) => new
    {
        medicationId,
        kind = "asNeeded",
        dose = dose ?? new { amount = 2, unit = "drops" },
        minIntervalMinutes,
        maxDosesPer24h = 3,
        indication = "belly pain",
        intervalGroup = group,
        startDate,
        prescriber = "Dr. Ana",
        updatedAt,
    };

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.ReadAsync<JsonElement>();

    private static async Task<Guid> CreateMedicationAsync(HttpClient client, Guid babyId, string name = "Colidis")
    {
        var medicationId = Guid.NewGuid();
        var response = await client.PutAsJsonAsync($"{BabyPath(babyId)}/medications/{medicationId}", new { name, isUsual = true });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return medicationId;
    }

    [Fact]
    public async Task Put_New_Returns201AndReplayReturnsTheSameRepresentation()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var medicationId = await CreateMedicationAsync(client, baby.BabyId);
        var id = Guid.NewGuid();

        var created = await client.PutAsJsonAsync(PrescriptionPath(baby.BabyId, id), AsNeeded(medicationId, group: " Cólica "));
        var replay = await client.PutAsJsonAsync(PrescriptionPath(baby.BabyId, id), AsNeeded(medicationId, group: " Cólica "));

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(PrescriptionPath(baby.BabyId, id), created.Headers.Location?.OriginalString);
        var body = await JsonAsync(created);
        Assert.Equal(("asNeeded", "active", "colica", 480, "belly pain"), (body.GetProperty("kind").GetString(), body.GetProperty("status").GetString(), body.GetProperty("intervalGroup").GetString(), body.GetProperty("minIntervalMinutes").GetInt32(), body.GetProperty("indication").GetString()));
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var replayed = await JsonAsync(replay);
        Assert.Equal(body.GetProperty("updatedAt").GetDateTimeOffset(), replayed.GetProperty("updatedAt").GetDateTimeOffset());
        Assert.Equal(body.GetProperty("dose").GetProperty("amount").GetDecimal(), replayed.GetProperty("dose").GetProperty("amount").GetDecimal());
        Assert.Equal(1, await factory.QueryAsync(context => context.Prescriptions.CountAsync(prescription => prescription.Id == id)));
    }

    [Fact]
    public async Task Put_ScheduledTimesOfDay_IsStoredSorted()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var medicationId = await CreateMedicationAsync(client, baby.BabyId);

        var response = await client.PutAsJsonAsync(PrescriptionPath(baby.BabyId, Guid.NewGuid()), new
        {
            medicationId,
            kind = "scheduled",
            dose = new { amount = 1, unit = "drop", perKg = true, roundingStep = 0.5 },
            timesOfDay = new[] { "20:00", "08:00" },
            startDate = "2026-01-01",
            endDate = "2026-01-31",
        });

        var body = await JsonAsync(response);
        Assert.Equal(["08:00", "20:00"], body.GetProperty("timesOfDay").EnumerateArray().Select(time => time.GetString()));
        Assert.Equal((true, 0.5m, "2026-01-31"), (body.GetProperty("dose").GetProperty("perKg").GetBoolean(), body.GetProperty("dose").GetProperty("roundingStep").GetDecimal(), body.GetProperty("endDate").GetString()));
    }

    [Theory]
    [InlineData("""{"medicationId":"{M}","dose":{"amount":1,"unit":"drop"},"minIntervalMinutes":60,"startDate":"2026-01-01"}""", "kind")]
    [InlineData("""{"medicationId":"{M}","kind":"asNeeded","dose":{"amount":1,"unit":"drop"},"startDate":"2026-01-01"}""", "minIntervalMinutes")]
    [InlineData("""{"medicationId":"{M}","kind":"asNeeded","dose":{"amount":1,"unit":"drop"},"minIntervalMinutes":10,"startDate":"2026-01-01"}""", "minIntervalMinutes")]
    [InlineData("""{"medicationId":"{M}","kind":"asNeeded","dose":{"amount":1,"unit":"drop"},"minIntervalMinutes":60,"maxDosesPer24h":25,"startDate":"2026-01-01"}""", "maxDosesPer24h")]
    [InlineData("""{"medicationId":"{M}","kind":"scheduled","dose":{"amount":1,"unit":"drop"},"timesOfDay":["08:00"],"everyMinutes":60,"startDate":"2026-01-01"}""", "timesOfDay")]
    [InlineData("""{"medicationId":"{M}","kind":"scheduled","dose":{"amount":1,"unit":"drop"},"timesOfDay":["8h"],"startDate":"2026-01-01"}""", "timesOfDay")]
    [InlineData("""{"medicationId":"{M}","kind":"asNeeded","dose":{"amount":0,"unit":"drop"},"minIntervalMinutes":60,"startDate":"2026-01-01"}""", "dose.amount")]
    [InlineData("""{"medicationId":"{M}","kind":"asNeeded","minIntervalMinutes":60,"startDate":"2026-01-01"}""", "dose")]
    [InlineData("""{"medicationId":"{M}","kind":"asNeeded","dose":{"amount":1,"unit":"drop"},"minIntervalMinutes":60}""", "startDate")]
    [InlineData("""{"medicationId":"{M}","kind":"asNeeded","dose":{"amount":1,"unit":"drop"},"minIntervalMinutes":60,"startDate":"2026-01-10","endDate":"2026-01-09"}""", "endDate")]
    [InlineData("""{"medicationId":"{M}","kind":"asNeeded","dose":{"amount":1,"unit":"drop"},"minIntervalMinutes":60,"startDate":"2026-01-01","instructions":"a\u0000b"}""", "instructions")]
    public async Task Put_InvalidRule_Returns400WithTheField(string json, string field)
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var medicationId = await CreateMedicationAsync(client, baby.BabyId);

        var response = await client.PutAsync(PrescriptionPath(baby.BabyId, Guid.NewGuid()), new StringContent(json.Replace("{M}", medicationId.ToString()), Encoding.UTF8, "application/json"));

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_UnknownKind_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PutAsync(
            PrescriptionPath(baby.BabyId, Guid.NewGuid()),
            new StringContent($$"""{"medicationId":"{{Guid.NewGuid()}}","kind":"sometimes","startDate":"2026-01-01"}""", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Put_MedicationOfAnotherBaby_Returns422()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var theirs = await CreateMedicationAsync(As(other, BabyRole.Owner), other.BabyId);

        var response = await As(mine, BabyRole.Owner).PutAsJsonAsync(PrescriptionPath(mine.BabyId, Guid.NewGuid()), AsNeeded(theirs));

        await response.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "prescription_medication_not_found");
    }

    [Fact]
    public async Task Put_IdOfAnotherBabysPrescription_Returns409()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        await As(other, BabyRole.Owner).PutAsJsonAsync(PrescriptionPath(other.BabyId, id), AsNeeded(await CreateMedicationAsync(As(other, BabyRole.Owner), other.BabyId)));

        var response = await As(mine, BabyRole.Owner).PutAsJsonAsync(PrescriptionPath(mine.BabyId, id), AsNeeded(await CreateMedicationAsync(As(mine, BabyRole.Owner), mine.BabyId)));

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "prescription_baby_mismatch");
    }

    [Fact]
    public async Task Roles_ViewerReadsButCannotWriteNonMemberGets403()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer, BabyRole.Parent);
        var medicationId = await CreateMedicationAsync(As(baby, BabyRole.Owner), baby.BabyId);

        var parentWrite = await As(baby, BabyRole.Parent).PutAsJsonAsync(PrescriptionPath(baby.BabyId, Guid.NewGuid()), AsNeeded(medicationId));
        var viewerWrite = await As(baby, BabyRole.Viewer).PutAsJsonAsync(PrescriptionPath(baby.BabyId, Guid.NewGuid()), AsNeeded(medicationId));
        var viewerDelete = await As(baby, BabyRole.Viewer).DeleteAsync(PrescriptionPath(baby.BabyId, Guid.NewGuid()));
        var viewerRead = await As(baby, BabyRole.Viewer).GetAsync($"{BabyPath(baby.BabyId)}/prescriptions");
        var viewerStatus = await As(baby, BabyRole.Viewer).GetAsync($"{BabyPath(baby.BabyId)}/medications/status");
        var stranger = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync($"{BabyPath(baby.BabyId)}/prescriptions");
        var anonymous = await factory.CreateClient().GetAsync($"{BabyPath(baby.BabyId)}/medications/status");

        Assert.Equal(
            [HttpStatusCode.Created, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden, HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized],
            [parentWrite.StatusCode, viewerWrite.StatusCode, viewerDelete.StatusCode, viewerRead.StatusCode, viewerStatus.StatusCode, stranger.StatusCode, anonymous.StatusCode]);
    }

    [Fact]
    public async Task Delete_SoftDeletesAppearsInTheDeltaAndLaterPutsAreNoOps()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var medicationId = await CreateMedicationAsync(client, baby.BabyId);
        var id = Guid.NewGuid();
        await client.PutAsJsonAsync(PrescriptionPath(baby.BabyId, id), AsNeeded(medicationId));

        var first = await client.DeleteAsync(PrescriptionPath(baby.BabyId, id));
        var second = await client.DeleteAsync(PrescriptionPath(baby.BabyId, id));
        var unknown = await client.DeleteAsync(PrescriptionPath(baby.BabyId, Guid.NewGuid()));
        var resurrect = await JsonAsync(await client.PutAsJsonAsync(PrescriptionPath(baby.BabyId, id), AsNeeded(medicationId, minIntervalMinutes: 60)));
        var delta = await JsonAsync(await client.GetAsync($"{BabyPath(baby.BabyId)}/prescriptions"));

        Assert.Equal([HttpStatusCode.NoContent, HttpStatusCode.NoContent, HttpStatusCode.NoContent], [first.StatusCode, second.StatusCode, unknown.StatusCode]);
        Assert.Equal((480, JsonValueKind.String), (resurrect.GetProperty("minIntervalMinutes").GetInt32(), resurrect.GetProperty("deletedAt").ValueKind));
        Assert.Equal(JsonValueKind.String, Assert.Single(delta.EnumerateArray()).GetProperty("deletedAt").ValueKind);
    }

    [Fact]
    public async Task List_Since_ReturnsOnlyChangesAtOrAfterTheCursorInOrder()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var medicationId = await CreateMedicationAsync(client, baby.BabyId);
        var first = await JsonAsync(await client.PutAsJsonAsync(PrescriptionPath(baby.BabyId, Guid.NewGuid()), AsNeeded(medicationId)));
        await Task.Delay(20);
        var second = await JsonAsync(await client.PutAsJsonAsync(PrescriptionPath(baby.BabyId, Guid.NewGuid()), AsNeeded(medicationId)));
        var cursor = second.GetProperty("updatedAt").GetDateTimeOffset();

        var all = await JsonAsync(await client.GetAsync($"{BabyPath(baby.BabyId)}/prescriptions"));
        var since = await JsonAsync(await client.GetAsync($"{BabyPath(baby.BabyId)}/prescriptions?since={Uri.EscapeDataString(cursor.ToString("O"))}"));

        Assert.Equal([first.GetProperty("id").GetGuid(), second.GetProperty("id").GetGuid()], all.EnumerateArray().Select(item => item.GetProperty("id").GetGuid()));
        Assert.Equal(second.GetProperty("id").GetGuid(), Assert.Single(since.EnumerateArray()).GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Put_StaleClientTime_IsIgnored()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var medicationId = await CreateMedicationAsync(client, baby.BabyId);
        var id = Guid.NewGuid();
        var edited = DateTimeOffset.UtcNow.AddMinutes(-1);
        await client.PutAsJsonAsync(PrescriptionPath(baby.BabyId, id), AsNeeded(medicationId, updatedAt: edited));

        var stale = await JsonAsync(await client.PutAsJsonAsync(PrescriptionPath(baby.BabyId, id), AsNeeded(medicationId, minIntervalMinutes: 60, updatedAt: edited.AddMinutes(-5))));

        Assert.Equal(480, stale.GetProperty("minIntervalMinutes").GetInt32());
    }

    [Fact]
    public async Task DeleteMedication_SoftDeletesItsPrescriptions()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var medicationId = await CreateMedicationAsync(client, baby.BabyId);
        var id = Guid.NewGuid();
        await client.PutAsJsonAsync(PrescriptionPath(baby.BabyId, id), AsNeeded(medicationId));

        var deleted = await client.DeleteAsync($"{BabyPath(baby.BabyId)}/medications/{medicationId}");

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        var delta = await JsonAsync(await client.GetAsync($"{BabyPath(baby.BabyId)}/prescriptions"));
        Assert.Equal(JsonValueKind.String, Assert.Single(delta.EnumerateArray()).GetProperty("deletedAt").ValueKind);
        Assert.Equal(0, await factory.QueryAsync(context => context.Medications.CountAsync(medication => medication.Id == medicationId)));
    }

    [Fact]
    public async Task MedicationEvent_PrescriptionReferences_AreCheckedAndLegacyPayloadsStillWork()
    {
        var baby = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var medicationId = await CreateMedicationAsync(client, baby.BabyId);
        var prescriptionId = Guid.NewGuid();
        await client.PutAsJsonAsync(PrescriptionPath(baby.BabyId, prescriptionId), AsNeeded(medicationId));
        var otherMedication = await CreateMedicationAsync(As(other, BabyRole.Owner), other.BabyId);
        var otherPrescription = Guid.NewGuid();
        await As(other, BabyRole.Owner).PutAsJsonAsync(PrescriptionPath(other.BabyId, otherPrescription), AsNeeded(otherMedication));

        var valid = await PutDoseEventAsync(client, baby.BabyId, $$"""{"medications":[{"medicationId":"{{medicationId}}","name":"Colidis","dose":{"amount":2,"unit":"drops"},"prescriptionId":"{{prescriptionId}}","override":true,"kgUsed":4.6}]}""");
        var legacy = await PutDoseEventAsync(client, baby.BabyId, $$"""{"medications":[{"medicationId":"{{medicationId}}","name":"Colidis"}]}""");
        var foreign = await PutDoseEventAsync(client, baby.BabyId, $$"""{"medications":[{"medicationId":"{{medicationId}}","name":"Colidis","prescriptionId":"{{otherPrescription}}"}]}""");
        var unknown = await PutDoseEventAsync(client, baby.BabyId, $$"""{"medications":[{"medicationId":"{{medicationId}}","name":"Colidis","prescriptionId":"{{Guid.NewGuid()}}"}]}""");
        var badOverride = await PutDoseEventAsync(client, baby.BabyId, $$"""{"medications":[{"medicationId":"{{medicationId}}","name":"Colidis","override":"yes"}]}""");

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.Created), (valid.StatusCode, legacy.StatusCode));
        Assert.Equal("medications[0].prescriptionId", (await foreign.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
        Assert.Equal("medications[0].prescriptionId", (await unknown.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
        Assert.Equal("medications[0].override", (await badOverride.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
    }

    [Fact]
    public async Task Status_FixedClock_ComputesGroupIntervalLimitAndPerKgSuggestion()
    {
        var now = new DateTimeOffset(2026, 3, 2, 15, 0, 0, TimeSpan.Zero);
        using var host = WithClock(now);
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var owner = ClientFor(host, baby.OwnerSubject);
        var colidis = await CreateMedicationAsync(owner, baby.BabyId, "Colidis");
        var simethicone = await CreateMedicationAsync(owner, baby.BabyId, "Simethicone drops");
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        await owner.PutAsJsonAsync(PrescriptionPath(baby.BabyId, first), AsNeeded(colidis, group: "colic", dose: new { amount = 1, unit = "drop", perKg = true, roundingStep = 1 }));
        await owner.PutAsJsonAsync(PrescriptionPath(baby.BabyId, second), AsNeeded(simethicone, group: "colic"));
        await owner.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/measurements/{Guid.NewGuid()}", new { date = "2026-02-25", weightKg = 4.6 });
        var givenAt = new DateTimeOffset(2026, 3, 2, 13, 0, 0, TimeSpan.Zero);
        Assert.Equal(HttpStatusCode.Created, (await PutDoseEventAsync(owner, baby.BabyId, $$"""{"medications":[{"medicationId":"{{colidis}}","name":"Colidis","prescriptionId":"{{first}}"}]}""", givenAt)).StatusCode);

        var status = await JsonAsync(await ClientFor(host, baby.SubjectOf(BabyRole.Viewer)).GetAsync($"{BabyPath(baby.BabyId)}/medications/status?utcOffsetMinutes=-180"));

        Assert.Equal((-180, now), (status.GetProperty("utcOffsetMinutes").GetInt32(), status.GetProperty("generatedAt").GetDateTimeOffset()));
        var items = status.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(["Colidis", "Simethicone drops"], items.Select(item => item.GetProperty("medicationName").GetString()));
        Assert.All(items, item => Assert.Equal(givenAt.AddHours(8), item.GetProperty("availableAt").GetDateTimeOffset()));
        Assert.All(items, item => Assert.False(item.GetProperty("availableNow").GetBoolean()));
        var colidisStatus = items[0];
        Assert.Equal((1, false, "asNeeded", "colic"), (colidisStatus.GetProperty("dosesLast24h").GetInt32(), colidisStatus.GetProperty("limitReached").GetBoolean(), colidisStatus.GetProperty("kind").GetString(), colidisStatus.GetProperty("intervalGroup").GetString()));
        Assert.Equal(second, Assert.Single(colidisStatus.GetProperty("groupMembers").EnumerateArray()).GetProperty("prescriptionId").GetGuid());
        var suggestion = colidisStatus.GetProperty("suggestedDose");
        Assert.Equal((5m, 4.6m, 4.6m, "2026-02-25", false), (suggestion.GetProperty("amount").GetDecimal(), suggestion.GetProperty("exactAmount").GetDecimal(), suggestion.GetProperty("kgUsed").GetDecimal(), suggestion.GetProperty("weightDate").GetString(), suggestion.GetProperty("stale").GetBoolean()));
        Assert.Equal(JsonValueKind.Null, items[1].GetProperty("suggestedDose").ValueKind);
    }

    [Fact]
    public async Task Status_ScheduledWithOffset_ReportsOverdueAndNextInUtc()
    {
        using var morning = WithClock(new DateTimeOffset(2026, 3, 2, 8, 0, 0, TimeSpan.Zero));
        using var noon = WithClock(new DateTimeOffset(2026, 3, 2, 12, 30, 0, TimeSpan.Zero));
        var baby = await factory.SeedBabyAsync();
        var owner = ClientFor(morning, baby.OwnerSubject);
        var medicationId = await CreateMedicationAsync(owner, baby.BabyId, "Vitamin D");
        await owner.PutAsJsonAsync(PrescriptionPath(baby.BabyId, Guid.NewGuid()), new { medicationId, kind = "scheduled", dose = new { amount = 2, unit = "drops" }, timesOfDay = new[] { "09:00" }, startDate = "2026-03-01" });

        var status = await JsonAsync(await ClientFor(noon, baby.OwnerSubject).GetAsync($"{BabyPath(baby.BabyId)}/medications/status?utcOffsetMinutes=-180"));

        var item = Assert.Single(status.GetProperty("items").EnumerateArray());
        Assert.Equal(30, item.GetProperty("overdueByMinutes").GetInt32());
        Assert.Equal(new DateTimeOffset(2026, 3, 3, 12, 0, 0, TimeSpan.Zero), item.GetProperty("nextScheduledAt").GetDateTimeOffset());
        Assert.True(item.GetProperty("availableNow").GetBoolean());
    }

    [Theory]
    [InlineData(-841)]
    [InlineData(841)]
    public async Task Status_OffsetOutOfRange_Returns400(int offset)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).GetAsync($"{BabyPath(baby.BabyId)}/medications/status?utcOffsetMinutes={offset}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static Task<HttpResponseMessage> PutDoseEventAsync(HttpClient client, Guid babyId, string payloadJson, DateTimeOffset? startedAt = null)
    {
        var at = (startedAt ?? new DateTimeOffset(2026, 1, 10, 8, 0, 0, TimeSpan.Zero)).ToString("O");
        var body = $$"""{"typeId":"{{BuiltInEventTypes.MedicationId}}","startedAt":"{{at}}","endedAt":"{{at}}","payload":{{payloadJson}}}""";
        return client.PutAsync($"{BabyPath(babyId)}/events/{Guid.NewGuid()}", new StringContent(body, Encoding.UTF8, "application/json"));
    }

    private WebApplicationFactory<Program> WithClock(DateTimeOffset now) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(new FixedTimeProvider(now))));

    private static HttpClient ClientFor(WebApplicationFactory<Program> host, string subject)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        return client;
    }
}
