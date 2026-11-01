using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Feeding;

/// <summary><c>GET/PUT /me/feeding-settings</c>: unset before the first PUT, round trip, refusals, every role, replay, account deletion.</summary>
public sealed class FeedingSettingsEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = "/api/v1/me/feeding-settings";

    [Fact]
    public async Task Get_BeforeAnyPut_IsUnset()
    {
        var json = await (await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal(JsonValueKind.Null, json.GetProperty("timeBottleFeedings").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("updatedAt").ValueKind);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Put_RoundTrips(bool value)
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());

        var saved = await (await client.PutAsJsonAsync(Path, new { timeBottleFeedings = value })).ReadAsync<JsonElement>();
        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal(value, saved.GetProperty("timeBottleFeedings").GetBoolean());
        Assert.Equal(value, read.GetProperty("timeBottleFeedings").GetBoolean());
        Assert.NotEqual(JsonValueKind.Null, read.GetProperty("updatedAt").ValueKind);
    }

    [Fact]
    public async Task Put_TheSecondPutWins_AndTheSameValueIsIdempotent()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());
        (await client.PutAsJsonAsync(Path, new { timeBottleFeedings = true })).EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync(Path, new { timeBottleFeedings = true })).EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync(Path, new { timeBottleFeedings = false })).EnsureSuccessStatusCode();

        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.False(read.GetProperty("timeBottleFeedings").GetBoolean());
    }

    [Fact]
    public async Task Put_MissingValue_Is400()
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PutAsJsonAsync(Path, new { });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("timeBottleFeedings", problem.GetProperty("field").GetString());
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

        var saved = await (await client.PutAsJsonAsync(Path, new { timeBottleFeedings = true })).ReadAsync<JsonElement>();
        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.True(saved.GetProperty("timeBottleFeedings").GetBoolean());
        Assert.True(read.GetProperty("timeBottleFeedings").GetBoolean());
    }

    [Fact]
    public async Task Settings_BelongToTheCallerOnly()
    {
        var mine = factory.CreateClientFor(TestUsers.NewSubject());
        var other = factory.CreateClientFor(TestUsers.NewSubject());
        (await mine.PutAsJsonAsync(Path, new { timeBottleFeedings = true })).EnsureSuccessStatusCode();

        var read = await (await other.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal(JsonValueKind.Null, read.GetProperty("timeBottleFeedings").ValueKind);
    }

    [Fact]
    public async Task Unauthenticated_Is401()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync(Path)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PutAsJsonAsync(Path, new { timeBottleFeedings = true })).StatusCode);
    }

    [Fact]
    public async Task DeleteAccount_RemovesTheSetting()
    {
        var subject = TestUsers.NewSubject();
        var client = factory.CreateClientFor(subject);
        (await client.PutAsJsonAsync(Path, new { timeBottleFeedings = true })).EnsureSuccessStatusCode();
        var userId = await factory.UserIdAsync(subject);

        (await client.DeleteAsync("/api/v1/me")).EnsureSuccessStatusCode();

        Assert.False(await factory.QueryAsync(context => context.UserFeedingSettings.AnyAsync(row => row.UserId == userId)));
    }
}
