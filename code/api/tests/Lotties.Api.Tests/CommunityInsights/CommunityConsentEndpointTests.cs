using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Backups;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Users;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Lotties.Api.Tests.CommunityInsights;

/// <summary>
/// <c>GET</c> and <c>PUT /babies/{babyId}/community-consent</c> (docs/design/34-community-insights.md section 3, task T2): the per-baby
/// record and its management only. The roles of every caller are in <c>EndpointRoleMatrixTests</c>; here the round trip, the refusals,
/// withdrawal at once, the population a future run reads, the flag, the demo, the backup file and account deletion.
/// </summary>
public sealed class CommunityConsentEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string TextVersion = "ci-1";
    private const string DemoSigningKey = "unit-test-demo-signing-key-0123456789-abcdef";

    private static string PathOf(Guid babyId) => $"/api/v1/babies/{babyId}/community-consent";

    private static object TurnOn(string textVersion = TextVersion, bool guardianConfirmed = true) =>
        new { granted = true, textVersion, guardianConfirmed, locale = "pt-BR" };

    private static readonly object TurnOff = new { granted = false };

    private async Task<IReadOnlyList<Guid>> InForceAsync()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<ICommunityConsentRepository>().BabiesInForceAsync(CommunityConsentTexts.CurrentTextVersion);
    }

    [Fact]
    public async Task Get_BeforeAnyChange_IsNoneWithTheCurrentText()
    {
        var baby = await factory.SeedBabyAsync();

        var body = await (await factory.CreateClientFor(baby.OwnerSubject).GetAsync(PathOf(baby.BabyId))).ReadAsync<JsonElement>();

        Assert.Equal("none", body.GetProperty("status").GetString());
        Assert.Equal(TextVersion, body.GetProperty("currentTextVersion").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("latest").ValueKind);
        Assert.Empty(body.GetProperty("history").EnumerateArray());
    }

    [Fact]
    public async Task Put_ParentTurnsItOn_EveryOwnerAndParentSeesWhoAndWhen_AndTheBabyJoinsThePopulation()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var parent = factory.CreateClientFor(baby.SubjectOf(BabyRole.Parent));

        var mine = await (await parent.PutAsJsonAsync(PathOf(baby.BabyId), TurnOn())).ReadAsync<JsonElement>();
        var owners = await (await factory.CreateClientFor(baby.OwnerSubject).GetAsync(PathOf(baby.BabyId))).ReadAsync<JsonElement>();

        Assert.Equal("on", mine.GetProperty("status").GetString());
        Assert.True(mine.GetProperty("latest").GetProperty("byMe").GetBoolean());
        var latest = owners.GetProperty("latest");
        Assert.Equal(("granted", "Parent", false, TextVersion), (latest.GetProperty("action").GetString(), latest.GetProperty("byName").GetString(), latest.GetProperty("byMe").GetBoolean(), latest.GetProperty("textVersion").GetString()));
        Assert.False(string.IsNullOrEmpty(latest.GetProperty("policyVersion").GetString()));
        Assert.False(latest.TryGetProperty("userId", out _));
        Assert.Contains(baby.BabyId, await InForceAsync());
        var stored = await factory.QueryAsync(context => context.CommunityConsents.SingleAsync(entry => entry.BabyId == baby.BabyId));
        Assert.Equal((true, "pt-BR", "all"), (stored.GuardianConfirmed, stored.Locale, Assert.Single(stored.Scopes)));
    }

    [Fact]
    public async Task Put_SameAnswerTwice_RecordsOneLine()
    {
        var baby = await factory.SeedBabyAsync();
        var owner = factory.CreateClientFor(baby.OwnerSubject);

        await (await owner.PutAsJsonAsync(PathOf(baby.BabyId), TurnOn())).ReadAsync<JsonElement>();
        var again = await (await owner.PutAsJsonAsync(PathOf(baby.BabyId), TurnOn())).ReadAsync<JsonElement>();
        var offWhileNever = await factory.SeedBabyAsync();
        var none = await (await factory.CreateClientFor(offWhileNever.OwnerSubject).PutAsJsonAsync(PathOf(offWhileNever.BabyId), TurnOff)).ReadAsync<JsonElement>();

        Assert.Single(again.GetProperty("history").EnumerateArray());
        Assert.Equal("none", none.GetProperty("status").GetString());
        Assert.Empty(none.GetProperty("history").EnumerateArray());
    }

    [Fact]
    public async Task Put_AnotherParentWithdraws_TakesEffectAtOnce_AndKeepsTheHistoryNewestFirst()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var owner = factory.CreateClientFor(baby.OwnerSubject);
        await owner.PutAsJsonAsync(PathOf(baby.BabyId), TurnOn()).Ok();

        var off = await (await factory.CreateClientFor(baby.SubjectOf(BabyRole.Parent)).PutAsJsonAsync(PathOf(baby.BabyId), TurnOff)).ReadAsync<JsonElement>();

        Assert.Equal("off", off.GetProperty("status").GetString());
        Assert.Equal(["withdrawn", "granted"], off.GetProperty("history").EnumerateArray().Select(line => line.GetProperty("action").GetString()));
        Assert.Equal(["Parent", "Owner"], off.GetProperty("history").EnumerateArray().Select(line => line.GetProperty("byName").GetString()));
        Assert.DoesNotContain(baby.BabyId, await InForceAsync());
    }

    [Fact]
    public async Task Put_OnWithoutTheGuardianDeclaration_Is400AndRecordsNothing()
    {
        var baby = await factory.SeedBabyAsync();

        var problem = await (await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync(PathOf(baby.BabyId), TurnOn(guardianConfirmed: false))).AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");

        Assert.Equal("guardianConfirmed", problem.GetProperty("field").GetString());
        Assert.False(await factory.QueryAsync(context => context.CommunityConsents.AnyAsync(entry => entry.BabyId == baby.BabyId)));
    }

    [Fact]
    public async Task Put_OnForAnOlderScreen_Is409WithTheCurrentText()
    {
        var baby = await factory.SeedBabyAsync();

        var problem = await (await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync(PathOf(baby.BabyId), TurnOn(textVersion: "ci-0"))).AssertProblemAsync(HttpStatusCode.Conflict, "community_consent_version_outdated");

        Assert.Equal(TextVersion, problem.GetProperty("currentTextVersion").GetString());
    }

    [Fact]
    public async Task Put_WithoutGranted_Is400()
    {
        var baby = await factory.SeedBabyAsync();

        var problem = await (await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync(PathOf(baby.BabyId), new { textVersion = TextVersion })).AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");

        Assert.Equal("granted", problem.GetProperty("field").GetString());
    }

    [Theory]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Doctor)]
    public async Task Put_OtherMembers_Are403AndRecordNothing(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(role);

        var response = await factory.CreateClientFor(baby.SubjectOf(role)).PutAsJsonAsync(PathOf(baby.BabyId), TurnOn());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.False(await factory.QueryAsync(context => context.CommunityConsents.AnyAsync(entry => entry.BabyId == baby.BabyId)));
    }

    [Fact]
    public async Task Disabled_EveryRouteIs404ForEveryone()
    {
        var baby = await factory.SeedBabyAsync();
        using var disabled = factory.WithWebHostBuilder(builder => builder.UseSetting("CommunityInsights:Enabled", "false"));
        var owner = disabled.CreateClient();
        owner.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, baby.OwnerSubject);

        var responses = new[]
        {
            await owner.GetAsync(PathOf(baby.BabyId)),
            await owner.PutAsJsonAsync(PathOf(baby.BabyId), TurnOn()),
            await disabled.CreateClient().GetAsync(PathOf(baby.BabyId)),
        };

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.NotFound, response.StatusCode));
        Assert.False(await factory.QueryAsync(context => context.CommunityConsents.AnyAsync(entry => entry.BabyId == baby.BabyId)));
    }

    [Fact]
    public void Options_FlagIsOffByDefault()
    {
        Assert.False(new Lotties.Application.CommunityInsights.CommunityInsightsOptions().Enabled);
    }

    [Fact]
    public async Task DemoUser_CannotSeeOrTurnItOn()
    {
        using var host = factory.WithWebHostBuilder(builder => builder.UseSetting("Demo:SigningKey", DemoSigningKey));
        var started = await (await host.CreateClient().PostAsJsonAsync("/api/v1/demo/start", new { })).ReadAsync<JsonElement>();
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, new JsonWebTokenHandler().ReadJsonWebToken(started.GetProperty("accessToken").GetString()).Subject);
        client.DefaultRequestHeaders.Add(TestAuthHandler.IssuerHeader, User.DemoIssuer);
        var babyId = started.GetProperty("babyId").GetGuid();

        await (await client.GetAsync(PathOf(babyId))).AssertProblemAsync(HttpStatusCode.Forbidden, "demo_not_available");
        await (await client.PutAsJsonAsync(PathOf(babyId), TurnOn())).AssertProblemAsync(HttpStatusCode.Forbidden, "demo_not_available");
        Assert.False(await factory.QueryAsync(context => context.CommunityConsents.AnyAsync(entry => entry.BabyId == babyId)));
    }

    [Fact]
    public async Task Backup_NeverHoldsTheConsentHistory()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var parent = factory.CreateClientFor(baby.SubjectOf(BabyRole.Parent));
        await parent.PutAsJsonAsync(PathOf(baby.BabyId), TurnOn()).Ok();
        var parentId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Parent));

        var text = await factory.CreateClientFor(baby.OwnerSubject).ExportTextAsync(baby.BabyId);

        Assert.DoesNotContain("community", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(TextVersion, text, StringComparison.Ordinal);
        Assert.DoesNotContain(parentId.ToString(), text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task AccountDeletion_OfTheParentWhoSaidYes_KeepsTheStateUnderTheStandIn()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var parent = factory.CreateClientFor(baby.SubjectOf(BabyRole.Parent));
        await parent.PutAsJsonAsync(PathOf(baby.BabyId), TurnOn()).Ok();

        await parent.DeleteAsync("/api/v1/me").Ok();
        var after = await (await factory.CreateClientFor(baby.OwnerSubject).GetAsync(PathOf(baby.BabyId))).ReadAsync<JsonElement>();

        Assert.Equal("on", after.GetProperty("status").GetString());
        Assert.Equal("Former member", after.GetProperty("latest").GetProperty("byName").GetString());
    }

    [Fact]
    public async Task AccountDeletion_AloneOnTheBaby_ErasesItsLines()
    {
        var baby = await factory.SeedBabyAsync();
        var owner = factory.CreateClientFor(baby.OwnerSubject);
        await owner.PutAsJsonAsync(PathOf(baby.BabyId), TurnOn()).Ok();
        await owner.PutAsJsonAsync(PathOf(baby.BabyId), TurnOff).Ok();

        await owner.DeleteAsync("/api/v1/me").Ok();

        Assert.False(await factory.QueryAsync(context => context.CommunityConsents.AnyAsync(entry => entry.BabyId == baby.BabyId)));
    }
}
