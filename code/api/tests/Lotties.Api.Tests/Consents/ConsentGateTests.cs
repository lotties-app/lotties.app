using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Assistants;
using Lotties.Api.Tests.Backups;
using Lotties.Api.Tests.Board;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.Consents;

namespace Lotties.Api.Tests.Consents;

/// <summary>
/// The server-side consent gate (docs/design/38-consent-and-terms.md section 2, decision 4): a signed-in person without a current core
/// consent gets 403 <c>consent_required</c> on every baby route, whatever her role, before any binding or handler; with one, the
/// same call works; the routes that let her leave (and the ones that are not baby data) stay open.
/// </summary>
public sealed class ConsentGateTests : IClassFixture<ApiFactory>
{
    private static readonly string Current = ConsentVersions.Current.Version;
    private readonly ApiFactory _factory;

    public ConsentGateTests(ApiFactory factory)
    {
        _factory = factory;
        _factory.GrantConsentToNewUsers = false;
    }

    /// <summary>Baby routes every role can GET (the Doctor with the default scopes), plus the lists that are not scoped to one baby.</summary>
    public static TheoryData<BabyRole, string> RoleRoutes()
    {
        var cases = new TheoryData<BabyRole, string>();
        string[] routes =
        [
            "/api/v1/babies",
            "/api/v1/babies/{id}",
            "/api/v1/babies/{id}/events",
            "/api/v1/babies/{id}/timeline",
            "/api/v1/babies/{id}/notes",
            "/api/v1/babies/{id}/clinical-summary",
            "/api/v1/babies/{id}/medications",
            "/api/v1/babies/{id}/measurements",
            "/api/v1/babies/{id}/vaccinations",
            "/api/v1/doctor/patients",
        ];
        foreach (var role in Enum.GetValues<BabyRole>())
        {
            Array.ForEach(routes, route => cases.Add(role, route));
        }

        return cases;
    }

    [Theory]
    [MemberData(nameof(RoleRoutes))]
    public async Task BabyRoute_WithoutConsent_Is403ConsentRequired_AndWithItWorks(BabyRole role, string route)
    {
        var baby = await _factory.SeedBabyAsync(role == BabyRole.Owner ? [] : [role]);
        var client = _factory.CreateClientFor(baby.SubjectOf(role));
        var path = route.Replace("{id}", baby.BabyId.ToString(), StringComparison.Ordinal);

        var refused = await client.GetAsync(path);
        var problem = await refused.AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
        await client.PutAsJsonAsync("/api/v1/me/consents/core", new { version = Current, capacity = "authorised" }).Ok();
        var allowed = await client.GetAsync(path);

        Assert.Equal(Current, problem.GetProperty("currentVersion").GetString());
        Assert.True(allowed.StatusCode is not (HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) && (int)allowed.StatusCode < 500, $"{route} as {role} after consenting: {(int)allowed.StatusCode}");
    }

    [Fact]
    public async Task Gate_RunsBeforeBindingAndTheHandler_AWriteWithABadBodyIs403NotValidation()
    {
        var baby = await _factory.SeedBabyAsync();
        var client = _factory.CreateClientFor(baby.OwnerSubject);

        var put = await client.PutAsync($"/api/v1/babies/{baby.BabyId}/events/{Guid.NewGuid()}", new StringContent("not json", Encoding.UTF8, "application/json"));
        var create = await client.PostAsJsonAsync("/api/v1/babies", new { name = "Lia", birthDate = "2026-01-01" });

        await put.AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
        await create.AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
        Assert.Empty(await _factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task EveryRoleThatIsNotBabyData_AndEveryExitRoute_StaysOpenWithoutConsent()
    {
        var baby = await _factory.SeedBabyAsync();
        var client = _factory.CreateClientFor(baby.OwnerSubject);
        string[] open =
        [
            "/api/v1/me",
            "/api/v1/me/deletion-preview",
            "/api/v1/me/consents",
            "/api/v1/me/unit-settings",
            "/api/v1/me/assistant-settings",
            "/api/v1/vaccine-schedule",
            "/api/v1/age-norms",
            "/api/v1/catalog/products",
            "/api/v1/push/config",
            "/api/v1/push/subscriptions",
            "/api/v1/version",
        ];

        foreach (var path in open)
        {
            var response = await client.GetAsync(path);
            Assert.True(response.StatusCode is not (HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) && (int)response.StatusCode < 500, $"{path}: {(int)response.StatusCode}");
        }

        var health = await _factory.CreateClient().GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);
    }

    [Fact]
    public async Task Push_SubscribeSettingsPreferencesAndTest_AreBabyDataAndGated_TurningDevicesOffIsNot()
    {
        var baby = await _factory.SeedBabyAsync();
        var client = _factory.CreateClientFor(baby.OwnerSubject);

        await (await client.GetAsync("/api/v1/push/settings")).AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
        await (await client.GetAsync("/api/v1/push/preferences")).AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
        await (await client.PostAsJsonAsync("/api/v1/push/test", new { })).AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
        await (await client.PostAsJsonAsync("/api/v1/push/subscriptions", new { })).AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
        Assert.NotEqual(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/v1/push/subscriptions/revoke", new { endpoint = "https://push.example/x" })).StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, (await client.DeleteAsync($"/api/v1/push/subscriptions/{Guid.NewGuid()}")).StatusCode);
    }

    [Fact]
    public async Task Export_AndBackupImport_AreGated()
    {
        var baby = await _factory.SeedBabyAsync();
        var client = _factory.CreateClientFor(baby.OwnerSubject);

        await (await client.GetAsync($"/api/v1/babies/{baby.BabyId}/export")).AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
        await (await client.PostAsJsonAsync("/api/v1/babies/import/preview", new { })).AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
        await (await client.PostAsJsonAsync("/api/v1/babies/import", new { })).AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
        await (await client.PostAsync("/api/v1/invites/accept", new StringContent("{}", Encoding.UTF8, "application/json"))).AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
    }

    [Fact]
    public async Task OlderConsentVersion_IsNotCurrent_AndTheGateClosesAgain()
    {
        var baby = await _factory.SeedBabyAsync();
        var client = _factory.CreateClientFor(baby.OwnerSubject);
        await client.PutAsJsonAsync("/api/v1/me/consents/core", new { version = Current, capacity = "guardian" }).Ok();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/v1/babies/{baby.BabyId}")).StatusCode);

        await _factory.SetCoreVersionAsync(baby.OwnerSubject, "1999-01-01.1");

        await (await client.GetAsync($"/api/v1/babies/{baby.BabyId}")).AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
        await client.PutAsJsonAsync("/api/v1/me/consents/core", new { version = Current, capacity = "guardian" }).Ok();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/v1/babies/{baby.BabyId}")).StatusCode);
    }

    [Fact]
    public async Task OnePersonsConsent_DoesNotOpenAnotherPersonsGate()
    {
        var baby = await _factory.SeedBabyAsync(BabyRole.Parent);
        var owner = _factory.CreateClientFor(baby.OwnerSubject);
        var parent = _factory.CreateClientFor(baby.SubjectOf(BabyRole.Parent));
        await owner.PutAsJsonAsync("/api/v1/me/consents/core", new { version = Current, capacity = "guardian" }).Ok();

        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync($"/api/v1/babies/{baby.BabyId}")).StatusCode);
        await (await parent.GetAsync($"/api/v1/babies/{baby.BabyId}")).AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
    }

    [Fact]
    public async Task WithdrawnOptionalConsents_DoNotCloseTheGate_AndAnOptionalOneDoesNotOpenIt()
    {
        var baby = await _factory.SeedBabyAsync();
        var client = _factory.CreateClientFor(baby.OwnerSubject);
        await client.PutAsJsonAsync("/api/v1/me/consents/optional/push", new { granted = true }).Ok();

        await (await client.GetAsync($"/api/v1/babies/{baby.BabyId}")).AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
    }

    [Fact]
    public async Task BoardRoutes_AreNotBabyData_AndNeedNoConsent()
    {
        var board = _factory.BoardUser(BoardTestKit.Reader);

        var me = await board.GetAsync("/api/v1/board/me");

        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task AnonymousRoutes_AreUnaffected()
    {
        var alexa = await _factory.CreateClient().PostAsync("/api/v1/alexa", new StringContent("{}", Encoding.UTF8, "application/json"));
        var unauthenticated = await _factory.CreateClient().GetAsync("/api/v1/babies");

        Assert.Equal(HttpStatusCode.NotFound, alexa.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthenticated.StatusCode);
    }
}
