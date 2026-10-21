using System.Net;
using System.Net.Http.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Users;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Endpoints;

public sealed class MeEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Health_Anonymous_Returns200()
    {
        var response = await factory.CreateClient().GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task GetMe_Anonymous_Returns401()
    {
        var response = await factory.CreateClient().GetAsync("/api/v1/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task GetMe_FirstRequest_CreatesUserFromClaims()
    {
        var subject = TestUsers.NewSubject();

        var response = await factory.CreateClientFor(subject, name: "Ana", email: "ana@example.test").GetAsync("/api/v1/me");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<CurrentUserResponse>();
        var stored = await factory.QueryAsync(context => context.Users.SingleAsync(user => user.Subject == subject));
        Assert.Equal(stored.Id, body!.Id);
        Assert.Equal("Ana", body.DisplayName);
    }

    [Fact]
    public async Task GetMe_OnlyEmailClaim_NeverUsesOrReturnsTheEmail()
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject(), email: "bia@example.test").GetAsync("/api/v1/me");

        var text = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("bia@example.test", text, StringComparison.Ordinal);
        var body = await response.Content.ReadFromJsonAsync<CurrentUserResponse>();
        Assert.Equal("Parent", body!.DisplayName);
    }

    [Theory]
    [InlineData("bia.s", "bia", "bia.s")]
    [InlineData("bia@example.test", "bia", "bia")]
    public async Task GetMe_NoNameClaim_UsesPreferredUsernameWithoutAtThenNickname(string preferredUsername, string nickname, string expected)
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject(), email: "bia@example.test", preferredUsername: preferredUsername, nickname: nickname).GetAsync("/api/v1/me");

        var body = await response.Content.ReadFromJsonAsync<CurrentUserResponse>();
        Assert.Equal(expected, body!.DisplayName);
    }

    [Fact]
    public async Task GetMe_SameSubjectFromTwoIssuers_ProvisionsTwoUsers()
    {
        var subject = TestUsers.NewSubject();

        var first = await factory.CreateClientFor(subject, name: "Ana", issuer: "https://a.example.test/").GetFromJsonAsync<CurrentUserResponse>("/api/v1/me");
        var second = await factory.CreateClientFor(subject, name: "Eve", issuer: "https://b.example.test/").GetFromJsonAsync<CurrentUserResponse>("/api/v1/me");

        Assert.NotEqual(first!.Id, second!.Id);
        Assert.Equal(2, await CountUsersAsync(subject));
    }

    [Fact]
    public async Task GetMe_UserStoredWithoutIssuer_IsClaimedAndKeepsItsId()
    {
        var subject = TestUsers.NewSubject();
        var legacy = User.Create(User.UnknownIssuer, subject, "Ana", TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Users.Add(legacy);
            return Task.CompletedTask;
        });

        var body = await factory.CreateClientFor(subject, name: "Ana", issuer: "https://a.example.test/").GetFromJsonAsync<CurrentUserResponse>("/api/v1/me");

        Assert.Equal(legacy.Id, body!.Id);
        var stored = await factory.QueryAsync(context => context.Users.SingleAsync(user => user.Subject == subject));
        Assert.Equal("https://a.example.test/", stored.Issuer);
    }

    [Fact]
    public async Task GetMe_RepeatedRequests_ReuseTheSameUser()
    {
        var subject = TestUsers.NewSubject();
        var client = factory.CreateClientFor(subject, name: "Ana");

        var first = await client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/me");
        var second = await client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/me");

        Assert.Equal(first!.Id, second!.Id);
        Assert.Equal(1, await CountUsersAsync(subject));
    }

    [Fact]
    public async Task GetMe_ConcurrentFirstRequests_CreateExactlyOneUser()
    {
        var subject = TestUsers.NewSubject();
        var client = factory.CreateClientFor(subject, name: "Ana");

        var responses = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/me")));

        Assert.Single(responses.Select(response => response!.Id).Distinct());
        Assert.Equal(1, await CountUsersAsync(subject));
    }

    private Task<int> CountUsersAsync(string subject) =>
        factory.QueryAsync(context => context.Users.CountAsync(user => user.Subject == subject));
}
