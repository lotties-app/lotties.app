using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Units;

/// <summary><c>GET/PUT /me/unit-settings</c>: default auto, round trip, refusals, every role, replay, account deletion.</summary>
public sealed class UnitSettingsEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = "/api/v1/me/unit-settings";

    [Fact]
    public async Task Get_BeforeAnyPut_IsAuto()
    {
        var json = await (await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal("auto", json.GetProperty("system").GetString());
    }

    [Theory]
    [InlineData("us")]
    [InlineData("metric")]
    [InlineData("auto")]
    public async Task Put_KnownValue_RoundTrips(string system)
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());

        var saved = await (await client.PutAsJsonAsync(Path, new { system })).ReadAsync<JsonElement>();
        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal(system, saved.GetProperty("system").GetString());
        Assert.Equal(system, read.GetProperty("system").GetString());
    }

    [Fact]
    public async Task Put_ChangesTheStoredValue_AndTheSecondPutWins()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());
        (await client.PutAsJsonAsync(Path, new { system = "us" })).EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync(Path, new { system = "us" })).EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync(Path, new { system = "metric" })).EnsureSuccessStatusCode();

        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal("metric", read.GetProperty("system").GetString());
    }

    [Theory]
    [InlineData("imperial")]
    [InlineData("")]
    [InlineData("US ounces")]
    public async Task Put_UnknownValue_Is400(string system)
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PutAsJsonAsync(Path, new { system });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("system", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_MissingValue_Is400()
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PutAsJsonAsync(Path, new { });

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Doctor)]
    public async Task EveryRole_ReadsAndWritesItsOwnSetting(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor);
        var client = factory.CreateClientFor(baby.SubjectOf(role));

        var saved = await (await client.PutAsJsonAsync(Path, new { system = "us" })).ReadAsync<JsonElement>();
        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal("us", saved.GetProperty("system").GetString());
        Assert.Equal("us", read.GetProperty("system").GetString());
    }

    [Fact]
    public async Task Settings_BelongToTheCallerOnly()
    {
        var mine = factory.CreateClientFor(TestUsers.NewSubject());
        var other = factory.CreateClientFor(TestUsers.NewSubject());
        (await mine.PutAsJsonAsync(Path, new { system = "us" })).EnsureSuccessStatusCode();

        var read = await (await other.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal("auto", read.GetProperty("system").GetString());
    }

    [Fact]
    public async Task Unauthenticated_Is401()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync(Path)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PutAsJsonAsync(Path, new { system = "us" })).StatusCode);
    }

    [Fact]
    public async Task DeleteAccount_RemovesTheSetting()
    {
        var subject = TestUsers.NewSubject();
        var client = factory.CreateClientFor(subject);
        (await client.PutAsJsonAsync(Path, new { system = "us" })).EnsureSuccessStatusCode();
        var userId = await factory.UserIdAsync(subject);

        (await client.DeleteAsync("/api/v1/me")).EnsureSuccessStatusCode();

        Assert.False(await factory.QueryAsync(context => context.UserUnitSettings.AnyAsync(row => row.UserId == userId)));
    }
}
