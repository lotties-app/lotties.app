using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// <c>/babies/{id}/care-providers</c> (docs/design/22-care-providers.md): idempotent upsert, validation, soft delete
/// kept in the delta, offline replays, roles (Owner and Parent write, Caregiver and Viewer read, the Doctor gets 403)
/// and the appointment link. The server clock is fixed at 2026-01-10 12:00 UTC.
/// </summary>
public sealed class CareProviderEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateTimeOffset Now = TestUsers.Now;

    private readonly WebApplicationFactory<Program> _host =
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(new FixedTimeProvider(Now))));

    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private static string ProviderPath(Guid babyId, Guid providerId) => $"{BabyPath(babyId)}/care-providers/{providerId}";

    private static Dictionary<string, object?> Body(string name = "Dr. Ana Lima", object? updatedAt = null, bool favorite = false, bool deleted = false, string? website = "https://clinic.example") =>
        new()
        {
            ["name"] = name,
            ["specialty"] = "pediatrician",
            ["registrationCouncil"] = "CRM",
            ["registrationNumber"] = "123456",
            ["registrationRegion"] = "SP",
            ["clinicName"] = "Clinic Central",
            ["address"] = "Rua das Flores, 10\nSao Paulo",
            ["phone"] = "+55 11 5555-0000",
            ["whatsapp"] = "+55 11 95555-0000",
            ["email"] = "ana@clinic.example",
            ["website"] = website,
            ["notes"] = "Prefers morning visits",
            ["isFavorite"] = favorite,
            ["isDeleted"] = deleted,
            ["updatedAt"] = updatedAt,
        };

    private HttpClient As(SeededBaby baby, BabyRole role)
    {
        var client = _host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, baby.SubjectOf(role));
        return client;
    }

    private static Task<JsonElement> JsonAsync(HttpResponseMessage response) => response.ReadAsync<JsonElement>();

    private static async Task<JsonElement[]> ListAsync(HttpClient client, Guid babyId, string query = "")
    {
        var response = await client.GetAsync($"{BabyPath(babyId)}/care-providers{query}");
        return (await response.ReadAsync<JsonElement>()).EnumerateArray().ToArray();
    }

    private static Task<HttpResponseMessage> PutJsonAsync(HttpClient client, string path, string json) =>
        client.PutAsync(path, new StringContent(json, Encoding.UTF8, "application/json"));

    [Fact]
    public async Task Put_New_Returns201AndAReplayReturnsTheSameRepresentation()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var id = Guid.NewGuid();

        var created = await client.PutAsJsonAsync(ProviderPath(baby.BabyId, id), Body(name: "  Dr. Ana Lima  "));
        var replay = await client.PutAsJsonAsync(ProviderPath(baby.BabyId, id), Body());

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(ProviderPath(baby.BabyId, id), created.Headers.Location?.OriginalString);
        var body = await JsonAsync(created);
        Assert.Equal(("Dr. Ana Lima", "CRM", "123456", "SP", false, false), (body.GetProperty("name").GetString(), body.GetProperty("registrationCouncil").GetString(), body.GetProperty("registrationNumber").GetString(), body.GetProperty("registrationRegion").GetString(), body.GetProperty("isFavorite").GetBoolean(), body.GetProperty("isDeleted").GetBoolean()));
        Assert.Equal("Rua das Flores, 10\nSao Paulo", body.GetProperty("address").GetString());
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(body.GetProperty("updatedAt").GetDateTimeOffset(), (await JsonAsync(replay)).GetProperty("updatedAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Put_OnlyTheNameIsRequired_AndBlankOptionalsAreAbsent()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await PutJsonAsync(As(baby, BabyRole.Owner), ProviderPath(baby.BabyId, Guid.NewGuid()), """{"name":"Dr. Bia","phone":"   "}""");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await JsonAsync(response);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("phone").ValueKind);
        Assert.False(body.GetProperty("isFavorite").GetBoolean());
    }

    [Theory]
    [InlineData("""{"specialty":"ENT"}""", "name")]
    [InlineData("""{"name":"  "}""", "name")]
    [InlineData("""{"name":"Dr","registrationNumber":"1234567890123456789012345678901"}""", "registrationNumber")]
    [InlineData("""{"name":"Dr","phone":"1234567890123456789012345678901"}""", "phone")]
    [InlineData("""{"name":"Dr","website":"javascript:alert(1)"}""", "website")]
    [InlineData("""{"name":"Dr","notes":"a\u0000b"}""", "notes")]
    public async Task Put_InvalidTerms_Returns400WithTheField(string json, string field)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await PutJsonAsync(As(baby, BabyRole.Owner), ProviderPath(baby.BabyId, Guid.NewGuid()), json);

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_WebsiteWithoutASchemeOrWithHttp_IsAccepted()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);

        var bare = await client.PutAsJsonAsync(ProviderPath(baby.BabyId, Guid.NewGuid()), Body(website: "clinic.example/ana"));
        var http = await client.PutAsJsonAsync(ProviderPath(baby.BabyId, Guid.NewGuid()), Body(website: "HTTP://clinic.example"));

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.Created), (bare.StatusCode, http.StatusCode));
    }

    [Fact]
    public async Task Put_Delete_KeepsTheProviderInTheListAndTheDelta()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var id = Guid.NewGuid();
        await client.PutAsJsonAsync(ProviderPath(baby.BabyId, id), Body());

        var deleted = await client.PutAsJsonAsync(ProviderPath(baby.BabyId, id), Body(deleted: true, favorite: true));

        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        var listed = Assert.Single(await ListAsync(client, baby.BabyId));
        Assert.True(listed.GetProperty("isDeleted").GetBoolean());
        Assert.Single(await ListAsync(client, baby.BabyId, "?since=2020-01-01T00:00:00Z"));
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await client.DeleteAsync(ProviderPath(baby.BabyId, id))).StatusCode);
    }

    [Fact]
    public async Task Put_OfflineEditsReplayedOutOfOrder_TheNewerClientTimeWins()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var id = Guid.NewGuid();
        var newer = Now.AddMinutes(-1);
        var older = Now.AddMinutes(-10);

        await client.PutAsJsonAsync(ProviderPath(baby.BabyId, id), Body(name: "Newer", updatedAt: newer));
        var stale = await client.PutAsJsonAsync(ProviderPath(baby.BabyId, id), Body(name: "Older", updatedAt: older));

        Assert.Equal(HttpStatusCode.OK, stale.StatusCode);
        Assert.Equal("Newer", (await JsonAsync(stale)).GetProperty("name").GetString());
        Assert.Equal("Newer", Assert.Single(await ListAsync(client, baby.BabyId)).GetProperty("name").GetString());
    }

    [Fact]
    public async Task Put_IdOfAnotherBabysProvider_Returns409()
    {
        var first = await factory.SeedBabyAsync();
        var second = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        await As(first, BabyRole.Owner).PutAsJsonAsync(ProviderPath(first.BabyId, id), Body());

        var response = await As(second, BabyRole.Owner).PutAsJsonAsync(ProviderPath(second.BabyId, id), Body(name: "Hijack"));

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "care_provider_baby_mismatch");
    }

    [Fact]
    public async Task List_IsPerBabyAndTheDeltaFiltersBySince()
    {
        var baby = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        await client.PutAsJsonAsync(ProviderPath(baby.BabyId, Guid.NewGuid()), Body());
        await As(other, BabyRole.Owner).PutAsJsonAsync(ProviderPath(other.BabyId, Guid.NewGuid()), Body(name: "Other baby's"));

        var all = await ListAsync(client, baby.BabyId);
        var future = await ListAsync(client, baby.BabyId, "?since=2030-01-01T00:00:00Z");

        Assert.Equal(["Dr. Ana Lima"], all.Select(item => item.GetProperty("name").GetString()));
        Assert.Empty(future);
    }

    [Fact]
    public async Task Roles_OwnerAndParentWrite_CaregiverAndViewerOnlyRead()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer);
        var id = Guid.NewGuid();
        await As(baby, BabyRole.Owner).PutAsJsonAsync(ProviderPath(baby.BabyId, id), Body());

        var parent = await As(baby, BabyRole.Parent).PutAsJsonAsync(ProviderPath(baby.BabyId, Guid.NewGuid()), Body(name: "Dr. Caio"));
        var caregiver = await As(baby, BabyRole.Caregiver).PutAsJsonAsync(ProviderPath(baby.BabyId, id), Body(deleted: true));
        var viewer = await As(baby, BabyRole.Viewer).PutAsJsonAsync(ProviderPath(baby.BabyId, Guid.NewGuid()), Body());

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden), (parent.StatusCode, caregiver.StatusCode, viewer.StatusCode));
        Assert.Equal(2, (await ListAsync(As(baby, BabyRole.Caregiver), baby.BabyId)).Length);
        Assert.Equal(2, (await ListAsync(As(baby, BabyRole.Viewer), baby.BabyId)).Length);
    }

    /// <summary>The Doctor never sees or edits the directory: every route is 403 and the body carries nothing.</summary>
    [Theory]
    [InlineData("GET", "")]
    [InlineData("GET", "?since=2020-01-01T00:00:00Z")]
    [InlineData("PUT", "/{existing}")]
    [InlineData("PUT", "/{unknown}")]
    public async Task Doctor_EveryRoute_Returns403WithoutTheProvider(string method, string suffix)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var existing = Guid.NewGuid();
        await As(baby, BabyRole.Owner).PutAsJsonAsync(ProviderPath(baby.BabyId, existing), Body(name: "Second opinion"));
        var path = $"{BabyPath(baby.BabyId)}/care-providers{suffix.Replace("{existing}", existing.ToString(), StringComparison.Ordinal).Replace("{unknown}", Guid.NewGuid().ToString(), StringComparison.Ordinal)}";
        var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method == "PUT")
        {
            request.Content = JsonContent.Create(Body(deleted: true));
        }

        var response = await As(baby, BabyRole.Doctor).SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Second opinion", text, StringComparison.Ordinal);
        Assert.DoesNotContain(existing.ToString(), text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Appointment_CarriesTheProviderLinkAndKeepsTheCopiedTextWhenTheProviderIsDeleted()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var providerId = Guid.NewGuid();
        var appointmentId = Guid.NewGuid();
        await client.PutAsJsonAsync(ProviderPath(baby.BabyId, providerId), Body());

        var created = await client.PutAsJsonAsync(
            $"{BabyPath(baby.BabyId)}/appointments/{appointmentId}",
            new Dictionary<string, object?> { ["title"] = "Checkup", ["type"] = "consultation", ["startsAt"] = Now.AddDays(3), ["doctorName"] = "Dr. Ana Lima", ["location"] = "Clinic Central", ["providerId"] = providerId });
        await client.PutAsJsonAsync(ProviderPath(baby.BabyId, providerId), Body(deleted: true));
        var stored = await JsonAsync(await client.GetAsync($"{BabyPath(baby.BabyId)}/appointments/{appointmentId}"));

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(providerId, stored.GetProperty("providerId").GetGuid());
        Assert.Equal(("Dr. Ana Lima", "Clinic Central"), (stored.GetProperty("doctorName").GetString(), stored.GetProperty("location").GetString()));
    }

    [Fact]
    public async Task Appointment_WithoutAProvider_HasANullLink()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var appointmentId = Guid.NewGuid();

        await client.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/appointments/{appointmentId}", new Dictionary<string, object?> { ["title"] = "Checkup", ["type"] = "exam", ["startsAt"] = Now.AddDays(3) });
        var stored = await JsonAsync(await client.GetAsync($"{BabyPath(baby.BabyId)}/appointments/{appointmentId}"));

        Assert.Equal(JsonValueKind.Null, stored.GetProperty("providerId").ValueKind);
    }
}
