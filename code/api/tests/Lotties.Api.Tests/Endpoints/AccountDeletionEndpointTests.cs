using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Authentication;
using Lotties.Api.Tests.Support;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Users;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Endpoints;

public sealed class AccountDeletionEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string MePath = "/api/v1/me";
    private const string PreviewPath = "/api/v1/me/deletion-preview";
    private const string KeycloakAuthority = "https://auth.example.test/realms/lotties.app";

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private static string EventPath(Guid babyId, Guid eventId) => $"/api/v1/babies/{babyId}/events/{eventId}";

    private static object EventBody() => new
    {
        typeId = BuiltInEventTypes.FeedingId,
        startedAt = TestUsers.Now,
        payload = new { method = "bottle", amount = 120 },
        notes = "feed",
    };

    private async Task<Guid> LogEventAsync(SeededBaby baby, BabyRole role)
    {
        var eventId = Guid.NewGuid();
        (await As(baby, role).PutAsJsonAsync(EventPath(baby.BabyId, eventId), EventBody())).EnsureSuccessStatusCode();
        return eventId;
    }

    [Fact]
    public async Task Delete_Anonymous_Returns401()
    {
        var response = await factory.CreateClient().DeleteAsync(MePath);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Delete_OnlyMemberOfABaby_ErasesTheBabyAndAnonymizesTheUser()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var kept = await LogEventAsync(baby, BabyRole.Owner);
        var softDeleted = await LogEventAsync(baby, BabyRole.Owner);
        (await client.DeleteAsync(EventPath(baby.BabyId, softDeleted))).EnsureSuccessStatusCode();
        var userId = await factory.UserIdAsync(baby.OwnerSubject);

        var body = await (await client.DeleteAsync(MePath)).ReadAsync<AccountDeletionResponse>();

        Assert.False(body.IdentityRemoved);
        Assert.Empty(await factory.QueryAsync(context => context.Babies.Where(item => item.Id == baby.BabyId).ToListAsync()));
        Assert.Empty(await factory.QueryAsync(context => context.Events.IgnoreQueryFilters().Where(item => item.Id == kept || item.Id == softDeleted).ToListAsync()));
        Assert.Empty(await factory.QueryAsync(context => context.BabyMembers.Where(member => member.UserId == userId).ToListAsync()));
        var user = await factory.QueryAsync(context => context.Users.SingleAsync(item => item.Id == userId));
        Assert.Equal((User.DeletedIssuer, "Former member", true), (user.Issuer, user.DisplayName, user.IsDeleted));
        Assert.NotEqual(baby.OwnerSubject, user.Subject);
    }

    [Fact]
    public async Task Delete_ThenSignInAgainWithTheSameIdentity_StartsWithANewEmptyUser()
    {
        var baby = await factory.SeedBabyAsync();
        var oldId = await factory.UserIdAsync(baby.OwnerSubject);
        (await As(baby, BabyRole.Owner).DeleteAsync(MePath)).EnsureSuccessStatusCode();

        var fresh = await factory.CreateClientFor(baby.OwnerSubject, name: "Ana").GetFromJsonAsync<CurrentUserResponse>(MePath);

        Assert.NotEqual(oldId, fresh!.Id);
        Assert.Empty(await As(baby, BabyRole.Owner).GetFromJsonAsync<List<BabyResponseStub>>("/api/v1/babies") ?? []);
    }

    [Fact]
    public async Task Delete_ParentOfASharedBaby_LeavesTheBabyAndItsRecordsToTheOthers()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var eventId = await LogEventAsync(baby, BabyRole.Parent);
        var parentId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Parent));

        (await As(baby, BabyRole.Parent).DeleteAsync(MePath)).EnsureSuccessStatusCode();

        Assert.Single(await factory.QueryAsync(context => context.Babies.Where(item => item.Id == baby.BabyId).ToListAsync()));
        var stored = await factory.QueryAsync(context => context.Events.SingleAsync(item => item.Id == eventId));
        Assert.Equal(parentId, stored.CreatedBy);
        var members = await factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == baby.BabyId).ToListAsync());
        Assert.Equal([BabyRole.Owner], members.Select(member => member.Role));
        Assert.Equal("Former member", (await factory.QueryAsync(context => context.Users.SingleAsync(item => item.Id == parentId))).DisplayName);
    }

    [Fact]
    public async Task Delete_OnlyOwnerOfASharedBaby_Returns409AndChangesNothing()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);

        var response = await As(baby, BabyRole.Owner).DeleteAsync(MePath);

        var problem = await response.AssertProblemAsync(HttpStatusCode.Conflict, "account_deletion_blocked");
        Assert.Equal(baby.BabyId, problem.GetProperty("babyIds")[0].GetGuid());
        Assert.Equal(2, (await factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == baby.BabyId).ToListAsync())).Count);
        Assert.False((await factory.QueryAsync(context => context.Users.SingleAsync(item => item.Subject == baby.OwnerSubject))).IsDeleted);
    }

    [Fact]
    public async Task Delete_OneOfTwoOwners_IsAllowed()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Owner);

        var response = await As(baby, BabyRole.Owner).DeleteAsync(MePath);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Single(await factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == baby.BabyId).ToListAsync()));
    }

    [Fact]
    public async Task Preview_ListsErasedSharedAndBlockedBabies()
    {
        var me = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Me", TestUsers.Now);
        var other = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Other", TestUsers.Now);
        var alone = Baby.Create("Alone", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), me.Id, TestUsers.Now);
        var shared = Baby.Create("Shared", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), other.Id, TestUsers.Now);
        shared.AddMember(me.Id, BabyRole.Parent, TestUsers.Now);
        var blocked = Baby.Create("Blocked", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), me.Id, TestUsers.Now);
        blocked.AddMember(other.Id, BabyRole.Viewer, TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Users.AddRange(me, other);
            context.Babies.AddRange(alone, shared, blocked);
            return Task.CompletedTask;
        });

        var preview = await factory.CreateClientFor(me.Subject).GetFromJsonAsync<AccountDeletionPreviewResponse>(PreviewPath);

        Assert.Equal([alone.Id], preview!.DeletedBabies.Select(item => item.Id));
        Assert.Equal([shared.Id], preview.SharedBabies.Select(item => item.Id));
        Assert.Equal([blocked.Id], preview.BlockedBabies.Select(item => item.Id));
        Assert.False(preview.CanDelete);
    }

    [Fact]
    public async Task Delete_AdminClientNotConfigured_ErasesTheDataAndSaysTheSignInAccountStays()
    {
        var subject = TestUsers.NewSubject();
        var client = factory.CreateClientFor(subject, name: "Ana", issuer: KeycloakAuthority);

        var preview = await client.GetFromJsonAsync<JsonElement>(PreviewPath);
        var response = await client.DeleteAsync(MePath);

        Assert.False(preview.GetProperty("identityRemovable").GetBoolean());
        var body = await response.ReadAsync<JsonElement>();
        Assert.Equal(("not_configured", false), (body.GetProperty("identity").GetString(), body.GetProperty("identityRemoved").GetBoolean()));
        Assert.Empty(await factory.QueryAsync(context => context.Users.Where(user => user.Subject == subject).ToListAsync()));
    }

    [Fact]
    public async Task Delete_AdminClientConfigured_RemovesTheSignInAccountAtKeycloak()
    {
        var keycloak = new FakeKeycloak(_ => HttpStatusCode.NoContent);
        using var host = WithKeycloak(keycloak);
        var subject = TestUsers.NewSubject();
        var client = ClientFor(host, subject);

        var preview = await client.GetFromJsonAsync<JsonElement>(PreviewPath);
        var body = await (await client.DeleteAsync(MePath)).ReadAsync<JsonElement>();

        Assert.True(preview.GetProperty("identityRemovable").GetBoolean());
        Assert.Equal(("removed", true), (body.GetProperty("identity").GetString(), body.GetProperty("identityRemoved").GetBoolean()));
        Assert.Equal(
            [$"POST {KeycloakAuthority}/protocol/openid-connect/token", $"DELETE https://auth.example.test/admin/realms/lotties.app/users/{Uri.EscapeDataString(subject)}"],
            keycloak.Requests);
        Assert.Empty(await factory.QueryAsync(context => context.Users.Where(user => user.Subject == subject).ToListAsync()));
    }

    /// <summary>
    /// Keycloak down: the data is erased anyway (it was, before Keycloak was called) and the answer says the sign-in account
    /// stays. Retry: signing in again gives a new, empty account whose deletion asks Keycloak again; or the operator
    /// deletes the user logged by the API (docs/KEYCLOAK-ACCOUNT-DELETION.md).
    /// </summary>
    [Fact]
    public async Task Delete_KeycloakDown_ErasesTheDataAndSaysTheSignInAccountStays_AndASecondDeletionRetries()
    {
        var down = true;
        var keycloak = new FakeKeycloak(_ => down ? throw new HttpRequestException("connection refused") : HttpStatusCode.NoContent);
        using var host = WithKeycloak(keycloak);
        var subject = TestUsers.NewSubject();
        var baby = await (await ClientFor(host, subject).PostAsJsonAsync("/api/v1/babies", new { name = "Lia", birthDate = "2026-01-01" })).ReadAsync<JsonElement>();

        var failed = await (await ClientFor(host, subject).DeleteAsync(MePath)).ReadAsync<JsonElement>();
        down = false;
        var retried = await (await ClientFor(host, subject).DeleteAsync(MePath)).ReadAsync<JsonElement>();

        Assert.Equal(("failed", false), (failed.GetProperty("identity").GetString(), failed.GetProperty("identityRemoved").GetBoolean()));
        Assert.Empty(await factory.QueryAsync(context => context.Babies.Where(item => item.Id == baby.GetProperty("id").GetGuid()).ToListAsync()));
        Assert.Equal("removed", retried.GetProperty("identity").GetString());
        Assert.Empty(await factory.QueryAsync(context => context.Users.Where(user => user.Subject == subject).ToListAsync()));
    }

    private WebApplicationFactory<Program> WithKeycloak(FakeKeycloak keycloak) =>
        factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Auth:Authority", KeycloakAuthority);
            builder.UseSetting("Auth:Audience", "lotties-api");
            builder.UseSetting("Auth:AdminClientId", "lotties-account-deletion");
            builder.UseSetting("Auth:AdminClientSecret", "test-secret");
            builder.ConfigureTestServices(services =>
                services.AddHttpClient<IIdentityAccountRemover, KeycloakAccountRemover>().ConfigurePrimaryHttpMessageHandler(() => keycloak));
        });

    private static HttpClient ClientFor(WebApplicationFactory<Program> host, string subject)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        client.DefaultRequestHeaders.Add(TestAuthHandler.NameHeader, "Ana");
        client.DefaultRequestHeaders.Add(TestAuthHandler.IssuerHeader, KeycloakAuthority);
        return client;
    }

    private sealed record BabyResponseStub(Guid Id);

    /// <summary>Keycloak's token endpoint and admin users endpoint; <c>deleteUser</c> answers the delete (or throws, for "down").</summary>
    private sealed class FakeKeycloak(Func<HttpRequestMessage, HttpStatusCode> deleteUser) : HttpMessageHandler
    {
        public List<string> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add($"{request.Method} {request.RequestUri!.AbsoluteUri}");
            if (request.Method == HttpMethod.Post)
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("""{"access_token":"tok"}""", System.Text.Encoding.UTF8, "application/json") });
            }

            return Task.FromResult(new HttpResponseMessage(deleteUser(request)));
        }
    }
}
