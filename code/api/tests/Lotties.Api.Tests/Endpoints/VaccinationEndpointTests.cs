using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Push;
using Lotties.Domain.Babies;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// <c>/vaccine-schedule</c> (ETag, 304, cache headers), <c>/babies/{id}/vaccinations</c> (idempotent upsert, validation,
/// soft delete, delta, offline replays, roles) and <c>/babies/{id}/vaccine-profile</c>. The server clock is fixed at
/// 2026-01-10 12:00 UTC.
/// </summary>
public sealed class VaccinationEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateTimeOffset Now = TestUsers.Now;

    private readonly WebApplicationFactory<Program> _host =
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(new FixedTimeProvider(Now))));

    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private static string VaccinationPath(Guid babyId, Guid vaccinationId) => $"{BabyPath(babyId)}/vaccinations/{vaccinationId}";

    private static Dictionary<string, object?> Body(
        string? vaccineKey = "bcg",
        string? doseId = "bcg-1",
        string? customName = null,
        string givenOn = "2026-01-05",
        string network = "public",
        object? updatedAt = null,
        string? lot = "L123") =>
        new()
        {
            ["vaccineKey"] = vaccineKey,
            ["doseId"] = doseId,
            ["customName"] = customName,
            ["doseLabel"] = "Dose única",
            ["givenOn"] = givenOn,
            ["network"] = network,
            ["clinic"] = "UBS Centro",
            ["lot"] = lot,
            ["administeredBy"] = "Enf. Rita",
            ["notes"] = "Arm",
            ["updatedAt"] = updatedAt,
        };

    private HttpClient As(SeededBaby baby, BabyRole role)
    {
        var client = _host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, baby.SubjectOf(role));
        return client;
    }

    private static async Task<JsonElement[]> ListAsync(HttpClient client, Guid babyId, string query = "")
    {
        var response = await client.GetAsync($"{BabyPath(babyId)}/vaccinations{query}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.ReadAsync<JsonElement>()).EnumerateArray().ToArray();
    }

    private static Task<HttpResponseMessage> PutJsonAsync(HttpClient client, string path, string json) =>
        client.PutAsync(path, new StringContent(json, Encoding.UTF8, "application/json"));

    [Fact]
    public async Task GetSchedule_ReturnsTheShippedFileWithAnETagAndA304OnRevalidation()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);

        var response = await client.GetAsync("/api/v1/vaccine-schedule");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var etag = response.Headers.ETag;
        Assert.NotNull(etag);
        Assert.StartsWith("\"br-", etag!.Tag, StringComparison.Ordinal);
        Assert.Equal((true, TimeSpan.FromHours(1)), (response.Headers.CacheControl?.Private, response.Headers.CacheControl?.MaxAge));
        var body = await response.ReadAsync<JsonElement>();
        Assert.Equal(2, body.GetProperty("schemaVersion").GetInt32());
        Assert.Contains(body.GetProperty("doses").EnumerateArray(), dose => dose.GetProperty("doseId").GetString() == "hexavalente-1");

        var revalidation = new HttpRequestMessage(HttpMethod.Get, "/api/v1/vaccine-schedule");
        revalidation.Headers.IfNoneMatch.Add(etag);
        var notModified = await client.SendAsync(revalidation);
        Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);
        Assert.Empty(await notModified.Content.ReadAsByteArrayAsync());

        var stale = new HttpRequestMessage(HttpMethod.Get, "/api/v1/vaccine-schedule");
        stale.Headers.IfNoneMatch.Add(new EntityTagHeaderValue("\"br-2020-01-01-00000000\""));
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(stale)).StatusCode);
    }

    [Fact]
    public async Task Put_New_Returns201AndAReplayReturnsTheSameRepresentation()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var id = Guid.NewGuid();

        var created = await client.PutAsJsonAsync(VaccinationPath(baby.BabyId, id), Body(updatedAt: Now.AddMinutes(-1)));
        var replay = await client.PutAsJsonAsync(VaccinationPath(baby.BabyId, id), Body(updatedAt: Now.AddMinutes(-1)));

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal($"/api/v1/babies/{baby.BabyId}/vaccinations/{id}", created.Headers.Location?.OriginalString);
        var first = await created.ReadAsync<JsonElement>();
        Assert.Equal(("bcg", "bcg-1", "Dose única", "2026-01-05", "public", "L123"), (
            first.GetProperty("vaccineKey").GetString(),
            first.GetProperty("doseId").GetString(),
            first.GetProperty("doseLabel").GetString(),
            first.GetProperty("givenOn").GetString(),
            first.GetProperty("network").GetString(),
            first.GetProperty("lot").GetString()));
        Assert.Equal(JsonValueKind.Null, first.GetProperty("deletedAt").ValueKind);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(first.GetRawText(), (await replay.ReadAsync<JsonElement>()).GetRawText());
    }

    [Fact]
    public async Task Put_CustomVaccine_NeedsANameAndNoKey()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var client = As(baby, BabyRole.Parent);

        var custom = await client.PutAsJsonAsync(VaccinationPath(baby.BabyId, Guid.NewGuid()), Body(vaccineKey: null, doseId: null, customName: "  Raiva (viagem)  "));

        Assert.Equal(HttpStatusCode.Created, custom.StatusCode);
        Assert.Equal("Raiva (viagem)", (await custom.ReadAsync<JsonElement>()).GetProperty("customName").GetString());
    }

    [Theory]
    [InlineData("{\"vaccineKey\":null,\"doseId\":null,\"givenOn\":\"2026-01-05\",\"network\":\"public\"}", "customName")]
    [InlineData("{\"vaccineKey\":\"bcg\",\"customName\":\"BCG\",\"givenOn\":\"2026-01-05\",\"network\":\"public\"}", "customName")]
    [InlineData("{\"doseId\":\"bcg-1\",\"customName\":\"x\",\"givenOn\":\"2026-01-05\",\"network\":\"public\"}", "doseId")]
    [InlineData("{\"vaccineKey\":\"BCG!\",\"givenOn\":\"2026-01-05\",\"network\":\"public\"}", "vaccineKey")]
    [InlineData("{\"vaccineKey\":\"bcg\",\"network\":\"public\"}", "givenOn")]
    [InlineData("{\"vaccineKey\":\"bcg\",\"givenOn\":\"2026-01-12\",\"network\":\"public\"}", "givenOn")]
    [InlineData("{\"vaccineKey\":\"bcg\",\"givenOn\":\"1999-12-31\",\"network\":\"public\"}", "givenOn")]
    [InlineData("{\"vaccineKey\":\"bcg\",\"givenOn\":\"2026-01-05\"}", "network")]
    [InlineData("{\"vaccineKey\":\"bcg\",\"givenOn\":\"2026-01-05\",\"network\":\"public\",\"lot\":\"12345678901234567890123456789012345678901\"}", "lot")]
    public async Task Put_InvalidTerms_Returns400WithTheField(string json, string field)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await PutJsonAsync(As(baby, BabyRole.Owner), VaccinationPath(baby.BabyId, Guid.NewGuid()), json);

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_TomorrowInUtc_IsAcceptedForFamiliesAheadOfUtc()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PutAsJsonAsync(VaccinationPath(baby.BabyId, Guid.NewGuid()), Body(givenOn: "2026-01-11"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Put_OfflineEditsReplayedOutOfOrder_TheNewerClientTimeWins()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var id = Guid.NewGuid();
        await client.PutAsJsonAsync(VaccinationPath(baby.BabyId, id), Body(updatedAt: Now.AddMinutes(-30)));

        var newer = await client.PutAsJsonAsync(VaccinationPath(baby.BabyId, id), Body(lot: "NEW", updatedAt: Now.AddMinutes(-5)));
        var older = await client.PutAsJsonAsync(VaccinationPath(baby.BabyId, id), Body(lot: "OLD", updatedAt: Now.AddMinutes(-10)));

        Assert.Equal(HttpStatusCode.OK, newer.StatusCode);
        Assert.Equal(HttpStatusCode.OK, older.StatusCode);
        Assert.Equal("NEW", (await older.ReadAsync<JsonElement>()).GetProperty("lot").GetString());
    }

    [Fact]
    public async Task Delete_IsSoftIdempotentAndFinal_AndTheDeltaReturnsIt()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var id = Guid.NewGuid();
        await client.PutAsJsonAsync(VaccinationPath(baby.BabyId, id), Body());

        var deleted = await client.DeleteAsync(VaccinationPath(baby.BabyId, id));
        var again = await client.DeleteAsync(VaccinationPath(baby.BabyId, id));
        var unknown = await client.DeleteAsync(VaccinationPath(baby.BabyId, Guid.NewGuid()));
        var revive = await client.PutAsJsonAsync(VaccinationPath(baby.BabyId, id), Body(lot: "REVIVED", updatedAt: Now.AddMinutes(4)));

        Assert.Equal((HttpStatusCode.NoContent, HttpStatusCode.NoContent, HttpStatusCode.NoContent), (deleted.StatusCode, again.StatusCode, unknown.StatusCode));
        Assert.Equal(HttpStatusCode.OK, revive.StatusCode);
        var stored = await revive.ReadAsync<JsonElement>();
        Assert.Equal("L123", stored.GetProperty("lot").GetString());
        Assert.NotEqual(JsonValueKind.Null, stored.GetProperty("deletedAt").ValueKind);
        var delta = await ListAsync(client, baby.BabyId, $"?since={Uri.EscapeDataString(Now.AddMinutes(-1).ToString("O"))}");
        Assert.Equal(id.ToString(), Assert.Single(delta).GetProperty("id").GetString());
    }

    [Fact]
    public async Task List_WithoutSinceIsByGivenOnAndTheDeltaOnlyHasLaterChanges()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var later = Guid.NewGuid();
        var earlier = Guid.NewGuid();
        await client.PutAsJsonAsync(VaccinationPath(baby.BabyId, later), Body(givenOn: "2026-01-09"));
        await client.PutAsJsonAsync(VaccinationPath(baby.BabyId, earlier), Body(givenOn: "2026-01-02"));

        var all = await ListAsync(client, baby.BabyId);
        var none = await ListAsync(client, baby.BabyId, $"?since={Uri.EscapeDataString(Now.AddMinutes(1).ToString("O"))}");

        Assert.Equal([earlier.ToString(), later.ToString()], all.Select(item => item.GetProperty("id").GetString()));
        Assert.Empty(none);
    }

    [Fact]
    public async Task Put_IdOfAnotherBabysRecord_Returns409()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        await As(other, BabyRole.Owner).PutAsJsonAsync(VaccinationPath(other.BabyId, id), Body());

        var response = await As(mine, BabyRole.Owner).PutAsJsonAsync(VaccinationPath(mine.BabyId, id), Body());

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "vaccination_baby_mismatch");
    }

    [Theory]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Doctor)]
    public async Task ReadOnlyRoles_ReadTheRecordsButCannotChangeThem(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(role);
        var id = Guid.NewGuid();
        await As(baby, BabyRole.Owner).PutAsJsonAsync(VaccinationPath(baby.BabyId, id), Body());
        var reader = As(baby, role);

        var listed = await ListAsync(reader, baby.BabyId);
        var put = await reader.PutAsJsonAsync(VaccinationPath(baby.BabyId, Guid.NewGuid()), Body());
        var delete = await reader.DeleteAsync(VaccinationPath(baby.BabyId, id));

        Assert.Single(listed);
        Assert.Equal((HttpStatusCode.Forbidden, HttpStatusCode.Forbidden), (put.StatusCode, delete.StatusCode));
    }

    [Fact]
    public async Task VaccineProfile_DefaultsToPublic_AndAParentReplacesIt()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var parent = As(baby, BabyRole.Parent);

        var before = await (await parent.GetAsync(BabyPath(baby.BabyId))).ReadAsync<JsonElement>();
        var saved = await parent.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/vaccine-profile", new { vaccineProfile = "public+private", gestationalAgeWeeks = 34, rsvMaternalVaccination = "no" });
        var after = await (await As(baby, BabyRole.Owner).GetAsync("/api/v1/babies")).ReadAsync<JsonElement>();
        var cleared = await parent.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/vaccine-profile", new { vaccineProfile = "public" });

        Assert.Equal(("public", JsonValueKind.Null, JsonValueKind.Null), (before.GetProperty("vaccineProfile").GetString(), before.GetProperty("gestationalAgeWeeks").ValueKind, before.GetProperty("rsvMaternalVaccination").ValueKind));
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var listed = after.EnumerateArray().Single(item => item.GetProperty("id").GetString() == baby.BabyId.ToString());
        Assert.Equal(("public+private", 34, "no"), (listed.GetProperty("vaccineProfile").GetString(), listed.GetProperty("gestationalAgeWeeks").GetInt32(), listed.GetProperty("rsvMaternalVaccination").GetString()));
        var reset = await cleared.ReadAsync<JsonElement>();
        Assert.Equal(("public", JsonValueKind.Null), (reset.GetProperty("vaccineProfile").GetString(), reset.GetProperty("gestationalAgeWeeks").ValueKind));
    }

    [Theory]
    [InlineData("{\"vaccineProfile\":\"private\"}", "vaccineProfile")]
    [InlineData("{}", "vaccineProfile")]
    [InlineData("{\"vaccineProfile\":\"public\",\"gestationalAgeWeeks\":12}", "gestationalAgeWeeks")]
    public async Task VaccineProfile_Invalid_Returns400WithTheField(string json, string field)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await PutJsonAsync(As(baby, BabyRole.Owner), $"{BabyPath(baby.BabyId)}/vaccine-profile", json);

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }
}

/// <summary>The per-baby <c>vaccineReminders</c> preference (push configured): off by default, kept by a merge that leaves it out.</summary>
public sealed class VaccineReminderPreferenceEndpointTests(PushApiHost host) : IClassFixture<PushApiHost>
{
    [Fact]
    public async Task VaccineReminders_AreOffByDefaultAndAMergeKeepsThem()
    {
        var baby = await host.Factory.SeedBabyAsync();
        var owner = host.ClientFor(baby.SubjectOf(BabyRole.Owner));
        var path = $"/api/v1/babies/{baby.BabyId}/notification-preferences";

        var before = await (await owner.GetAsync("/api/v1/push/preferences")).ReadAsync<List<BabyNotificationPreferencesResponse>>();
        await owner.PutAsJsonAsync(path, new { vaccineReminders = true });
        var merged = await (await owner.PutAsJsonAsync(path, new { napWindow = true })).ReadAsync<BabyNotificationPreferencesResponse>();

        Assert.False(Assert.Single(before, item => item.BabyId == baby.BabyId).VaccineReminders);
        Assert.Equal((true, true, true), (merged.VaccineReminders, merged.NapWindow, merged.AppointmentReminders));
    }
}
