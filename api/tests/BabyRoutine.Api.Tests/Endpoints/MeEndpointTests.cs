using System.Net;
using System.Net.Http.Json;
using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Application.Users;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Api.Tests.Endpoints;

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
    public async Task GetMe_NoNameClaim_UsesEmailAsDisplayName()
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject(), email: "bia@example.test").GetAsync("/api/v1/me");

        var body = await response.Content.ReadFromJsonAsync<CurrentUserResponse>();
        Assert.Equal("bia@example.test", body!.DisplayName);
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
