using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Assistants;

/// <summary><c>GET/PUT /me/assistant-settings</c>: defaults, a baby the caller logs for, refusals, clearing, idempotence, account deletion.</summary>
public sealed class AssistantSettingsEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = "/api/v1/me/assistant-settings";

    [Fact]
    public async Task Get_BeforeAnyPut_ReturnsNoBaby()
    {
        var json = await (await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal(JsonValueKind.Null, json.GetProperty("defaultBabyId").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("updatedAt").ValueKind);
    }

    [Fact]
    public async Task SayBabyName_IsOffByDefault_RoundTrips_AndAnOlderClientWithoutTheMemberKeepsIt()
    {
        var baby = await factory.SeedBabyAsync();
        var client = factory.CreateClientFor(baby.OwnerSubject);

        var before = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();
        var oldClient = await (await client.PutAsJsonAsync(Path, new { defaultBabyId = baby.BabyId })).ReadAsync<JsonElement>();
        var on = await (await client.PutAsJsonAsync(Path, new { defaultBabyId = baby.BabyId, sayBabyName = true })).ReadAsync<JsonElement>();
        var oldClientAgain = await (await client.PutAsJsonAsync(Path, new { defaultBabyId = baby.BabyId })).ReadAsync<JsonElement>();
        var readOn = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();
        var off = await (await client.PutAsJsonAsync(Path, new { defaultBabyId = baby.BabyId, sayBabyName = false })).ReadAsync<JsonElement>();
        var readOff = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal([false, false, true, true, true, false, false], new[] { before, oldClient, on, oldClientAgain, readOn, off, readOff }.Select(json => json.GetProperty("sayBabyName").GetBoolean()));
    }

    [Fact]
    public async Task SayBabyName_FirstSaveWithTheMember_CreatesTheRowWithItOn()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());

        var saved = await (await client.PutAsJsonAsync(Path, new { sayBabyName = true })).ReadAsync<JsonElement>();
        var replay = await (await client.PutAsJsonAsync(Path, new { sayBabyName = true })).ReadAsync<JsonElement>();

        Assert.True(saved.GetProperty("sayBabyName").GetBoolean());
        Assert.Equal(JsonValueKind.Null, saved.GetProperty("defaultBabyId").ValueKind);
        Assert.Equal(saved.GetProperty("updatedAt").GetString(), replay.GetProperty("updatedAt").GetString());
    }

    [Fact]
    public async Task GetAndPut_McpDisabledByDefault_SayOffWithoutAUrl()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());

        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();
        var saved = await (await client.PutAsJsonAsync(Path, new { defaultBabyId = (Guid?)null })).ReadAsync<JsonElement>();

        Assert.All([read, saved], json => Assert.Equal((false, JsonValueKind.Null), (json.GetProperty("mcpEnabled").GetBoolean(), json.GetProperty("mcpUrl").ValueKind)));
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    public async Task Put_BabyTheCallerLogsFor_IsStoredAndReplayKeepsUpdatedAt(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver);
        var client = factory.CreateClientFor(baby.SubjectOf(role));

        var saved = await (await client.PutAsJsonAsync(Path, new { defaultBabyId = baby.BabyId })).ReadAsync<JsonElement>();
        var replay = await (await client.PutAsJsonAsync(Path, new { defaultBabyId = baby.BabyId })).ReadAsync<JsonElement>();
        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal(baby.BabyId, saved.GetProperty("defaultBabyId").GetGuid());
        Assert.Equal(saved.GetProperty("updatedAt").GetString(), replay.GetProperty("updatedAt").GetString());
        Assert.Equal(baby.BabyId, read.GetProperty("defaultBabyId").GetGuid());
    }

    [Theory]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Doctor)]
    public async Task Put_BabyTheCallerCannotLogFor_Is400(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer, BabyRole.Doctor);

        var response = await factory.CreateClientFor(baby.SubjectOf(role)).PutAsJsonAsync(Path, new { defaultBabyId = baby.BabyId });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("defaultBabyId", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_UnknownOrForeignBaby_Is400LikeAnyOther()
    {
        var other = await factory.SeedBabyAsync();

        var foreign = await factory.CreateClientFor(TestUsers.NewSubject()).PutAsJsonAsync(Path, new { defaultBabyId = other.BabyId });
        var unknown = await factory.CreateClientFor(TestUsers.NewSubject()).PutAsJsonAsync(Path, new { defaultBabyId = Guid.NewGuid() });

        await foreign.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        await unknown.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task Put_Null_ClearsTheDefault()
    {
        var baby = await factory.SeedBabyAsync();
        var client = factory.CreateClientFor(baby.OwnerSubject);
        (await client.PutAsJsonAsync(Path, new { defaultBabyId = baby.BabyId })).EnsureSuccessStatusCode();

        var cleared = await (await client.PutAsJsonAsync(Path, new { defaultBabyId = (Guid?)null })).ReadAsync<JsonElement>();

        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("defaultBabyId").ValueKind);
    }

    [Fact]
    public async Task DeleteAccount_RemovesTheSettings()
    {
        var baby = await factory.SeedBabyAsync();
        var client = factory.CreateClientFor(baby.OwnerSubject);
        (await client.PutAsJsonAsync(Path, new { defaultBabyId = baby.BabyId })).EnsureSuccessStatusCode();
        var userId = await factory.UserIdAsync(baby.OwnerSubject);

        (await client.DeleteAsync("/api/v1/me")).EnsureSuccessStatusCode();

        Assert.False(await factory.QueryAsync(context => context.UserAssistantSettings.AnyAsync(row => row.UserId == userId)));
    }

    [Fact]
    public async Task DeleteAccount_OfTheBabysOnlyMember_ClearsOthersDefaultsPointingAtIt()
    {
        var (subject, babyIds) = await factory.SeedMemberOfAsync(BabyRole.Parent);
        (await factory.CreateClientFor(subject).PutAsJsonAsync(Path, new { defaultBabyId = babyIds[0] })).EnsureSuccessStatusCode();
        (await factory.CreateClientFor(subject).DeleteAsync($"/api/v1/babies/{babyIds[0]}/members/me")).EnsureSuccessStatusCode();
        var ownerSubject = await factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == babyIds[0]).Join(context.Users, member => member.UserId, user => user.Id, (_, user) => user.Subject).SingleAsync());

        (await factory.CreateClientFor(ownerSubject).DeleteAsync("/api/v1/me")).EnsureSuccessStatusCode();

        var stored = await (await factory.CreateClientFor(subject).GetAsync(Path)).ReadAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, stored.GetProperty("defaultBabyId").ValueKind);
    }
}
