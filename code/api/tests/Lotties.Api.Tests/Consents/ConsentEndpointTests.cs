using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Backups;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.Consents;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Consents;

/// <summary>
/// <c>GET /me/consents</c>, <c>PUT /me/consents/core</c> and <c>PUT /me/consents/optional/{kind}</c> (docs/design/38-consent-and-terms.md):
/// round trip, history, the refusals, every role, the optional switches and account deletion. Users here start without a record
/// (<see cref="ApiFactory.GrantConsentToNewUsers"/> off).
/// </summary>
public sealed class ConsentEndpointTests : IClassFixture<ApiFactory>
{
    private const string Path = "/api/v1/me/consents";
    private static readonly string Current = ConsentVersions.Current.Version;
    private readonly ApiFactory _factory;

    public ConsentEndpointTests(ApiFactory factory)
    {
        _factory = factory;
        _factory.GrantConsentToNewUsers = false;
    }

    private HttpClient NewClient(out string subject)
    {
        subject = TestUsers.NewSubject();
        return _factory.CreateClientFor(subject);
    }

    [Fact]
    public async Task Get_NewUser_RequiresAcceptanceAndNamesTheCurrentVersions()
    {
        var json = await (await NewClient(out _).GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal(Current, json.GetProperty("currentVersion").GetString());
        Assert.Equal(ConsentVersions.Current.TermsVersion, json.GetProperty("termsVersion").GetString());
        Assert.Equal(ConsentVersions.Current.PrivacyPolicyVersion, json.GetProperty("privacyPolicyVersion").GetString());
        Assert.True(json.GetProperty("requiresAcceptance").GetBoolean());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("core").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("minorChangeSince").ValueKind);
        Assert.All(new[] { "push", "alexa", "mcp" }, kind => Assert.Equal(JsonValueKind.Null, json.GetProperty("optional").GetProperty(kind).ValueKind));
    }

    [Fact]
    public async Task PutCore_RoundTripsAndKeepsOneHistoryLine()
    {
        var client = NewClient(out var subject);

        var saved = await (await client.PutAsJsonAsync($"{Path}/core", new { version = Current, capacity = "guardian", locale = "pt-BR" })).ReadAsync<JsonElement>();
        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        foreach (var json in new[] { saved, read })
        {
            var core = json.GetProperty("core");
            Assert.False(json.GetProperty("requiresAcceptance").GetBoolean());
            Assert.True(core.GetProperty("accepted").GetBoolean());
            Assert.Equal((Current, "guardian", "pt-BR"), (core.GetProperty("version").GetString(), core.GetProperty("capacity").GetString(), core.GetProperty("locale").GetString()));
            Assert.True(core.GetProperty("acceptedAt").GetDateTimeOffset() > DateTimeOffset.UtcNow.AddMinutes(-5));
        }

        var userId = await _factory.UserIdAsync(subject);
        var history = await _factory.QueryAsync(context => context.UserConsentHistory.Where(row => row.UserId == userId).ToListAsync());
        var line = Assert.Single(history);
        Assert.Equal((ConsentKind.Core, ConsentAction.Granted, Current, ConsentCapacity.Guardian), (line.Kind, line.Action, line.Version, line.Capacity));
    }

    [Fact]
    public async Task PutCore_AgainWithTheSameAnswer_RecordsNothingNew_AndAChangedCapacityIsANewGrant()
    {
        var client = NewClient(out var subject);
        await client.PutAsJsonAsync($"{Path}/core", new { version = Current, capacity = "guardian" }).Ok();
        await client.PutAsJsonAsync($"{Path}/core", new { version = Current, capacity = "guardian" }).Ok();
        var userId = await _factory.UserIdAsync(subject);

        var afterRetry = await _factory.QueryAsync(context => context.UserConsentHistory.CountAsync(row => row.UserId == userId));
        await client.PutAsJsonAsync($"{Path}/core", new { version = Current, capacity = "authorised" }).Ok();
        var afterChange = await _factory.QueryAsync(context => context.UserConsentHistory.CountAsync(row => row.UserId == userId));
        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal((1, 2), (afterRetry, afterChange));
        Assert.Equal("authorised", read.GetProperty("core").GetProperty("capacity").GetString());
    }

    [Theory]
    [InlineData("1999-01-01.1")]
    [InlineData("2099-01-01.9")]
    public async Task PutCore_NotTheCurrentVersion_Is409WithTheCurrentOne_AndRecordsNothing(string version)
    {
        var client = NewClient(out _);

        var problem = await (await client.PutAsJsonAsync($"{Path}/core", new { version, capacity = "guardian" })).AssertProblemAsync(HttpStatusCode.Conflict, "consent_version_outdated");
        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal(Current, problem.GetProperty("currentVersion").GetString());
        Assert.True(read.GetProperty("requiresAcceptance").GetBoolean());
        Assert.Equal(JsonValueKind.Null, read.GetProperty("core").ValueKind);
    }

    [Theory]
    [InlineData(null, "capacity")]
    [InlineData("", "capacity")]
    [InlineData("friend", "capacity")]
    [InlineData("GUARDIAN", "capacity")]
    public async Task PutCore_MissingOrUnknownCapacity_Is400(string? capacity, string field)
    {
        var problem = await (await NewClient(out _).PutAsJsonAsync($"{Path}/core", new { version = Current, capacity })).AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");

        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task PutCore_MissingVersion_Is400()
    {
        var problem = await (await NewClient(out _).PutAsJsonAsync($"{Path}/core", new { capacity = "guardian" })).AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");

        Assert.Equal("version", problem.GetProperty("field").GetString());
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Doctor)]
    public async Task EveryRole_ConsentsForHerself(BabyRole role)
    {
        var baby = await _factory.SeedBabyAsync(role == BabyRole.Owner ? [] : [role]);
        var client = _factory.CreateClientFor(baby.SubjectOf(role));

        var before = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();
        var after = await (await client.PutAsJsonAsync($"{Path}/core", new { version = Current, capacity = role == BabyRole.Doctor ? "authorised" : "guardian" })).ReadAsync<JsonElement>();

        Assert.True(before.GetProperty("requiresAcceptance").GetBoolean());
        Assert.False(after.GetProperty("requiresAcceptance").GetBoolean());
        var owner = await (await _factory.CreateClientFor(baby.OwnerSubject).GetAsync(Path)).ReadAsync<JsonElement>();
        Assert.Equal(role != BabyRole.Owner, owner.GetProperty("requiresAcceptance").GetBoolean());
    }

    [Fact]
    public async Task Anonymous_Is401()
    {
        var client = _factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(Path)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PutAsJsonAsync($"{Path}/core", new { version = Current, capacity = "guardian" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PutAsJsonAsync($"{Path}/optional/push", new { granted = true })).StatusCode);
    }

    [Fact]
    public async Task StoredVersionThatIsNoLongerCurrent_RequiresAcceptanceAgain()
    {
        var client = NewClient(out var subject);
        await client.PutAsJsonAsync($"{Path}/core", new { version = Current, capacity = "guardian" }).Ok();
        await _factory.SetCoreVersionAsync(subject, "1999-01-01.1");

        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.True(read.GetProperty("requiresAcceptance").GetBoolean());
        Assert.Equal("1999-01-01.1", read.GetProperty("core").GetProperty("version").GetString());
    }

    [Theory]
    [InlineData("push")]
    [InlineData("alexa")]
    [InlineData("mcp")]
    public async Task PutOptional_OnThenOff_IsRecordedWithItsHistory_EvenWithoutTheCoreConsent(string kind)
    {
        var client = NewClient(out var subject);

        var on = await (await client.PutAsJsonAsync($"{Path}/optional/{kind}", new { granted = true, locale = "en" })).ReadAsync<JsonElement>();
        var off = await (await client.PutAsJsonAsync($"{Path}/optional/{kind}", new { granted = false })).ReadAsync<JsonElement>();
        var offAgain = await (await client.PutAsJsonAsync($"{Path}/optional/{kind}", new { granted = false })).ReadAsync<JsonElement>();

        Assert.True(on.GetProperty("optional").GetProperty(kind).GetProperty("accepted").GetBoolean());
        Assert.Equal(JsonValueKind.Null, on.GetProperty("optional").GetProperty(kind).GetProperty("withdrawnAt").ValueKind);
        Assert.False(off.GetProperty("optional").GetProperty(kind).GetProperty("accepted").GetBoolean());
        Assert.NotEqual(JsonValueKind.Null, off.GetProperty("optional").GetProperty(kind).GetProperty("withdrawnAt").ValueKind);
        Assert.False(offAgain.GetProperty("optional").GetProperty(kind).GetProperty("accepted").GetBoolean());
        Assert.True(on.GetProperty("requiresAcceptance").GetBoolean(), "an optional consent is not the core consent");
        var userId = await _factory.UserIdAsync(subject);
        var actions = await _factory.QueryAsync(context => context.UserConsentHistory.Where(row => row.UserId == userId).OrderBy(row => row.At).Select(row => row.Action).ToListAsync());
        Assert.Equal([ConsentAction.Granted, ConsentAction.Withdrawn], actions);
    }

    [Fact]
    public async Task PutOptional_OffBeforeEverOn_RecordsNothing()
    {
        var client = NewClient(out var subject);

        var json = await (await client.PutAsJsonAsync($"{Path}/optional/push", new { granted = false })).ReadAsync<JsonElement>();

        Assert.Equal(JsonValueKind.Null, json.GetProperty("optional").GetProperty("push").ValueKind);
        var userId = await _factory.UserIdAsync(subject);
        Assert.Empty(await _factory.QueryAsync(context => context.UserConsentHistory.Where(row => row.UserId == userId).ToListAsync()));
    }

    [Theory]
    [InlineData("core")]
    [InlineData("sms")]
    [InlineData("PUSH")]
    public async Task PutOptional_UnknownKind_Is404(string kind)
    {
        var response = await NewClient(out _).PutAsJsonAsync($"{Path}/optional/{kind}", new { granted = true });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task PutOptional_WithoutGranted_Is400()
    {
        var problem = await (await NewClient(out _).PutAsJsonAsync($"{Path}/optional/push", new { })).AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");

        Assert.Equal("granted", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task DeleteAccount_WithoutConsent_IsAllowed()
    {
        var baby = await _factory.SeedBabyAsync();
        var userId = await _factory.UserIdAsync(baby.OwnerSubject);
        Assert.Equal((0, 0), await CountsAsync(userId));

        var response = await _factory.CreateClientFor(baby.OwnerSubject).DeleteAsync("/api/v1/me");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task DeleteAccount_AfterConsenting_RemovesTheRecordsAndTheirHistory()
    {
        var client = NewClient(out var subject);
        await client.PutAsJsonAsync($"{Path}/core", new { version = Current, capacity = "guardian" }).Ok();
        await client.PutAsJsonAsync($"{Path}/optional/push", new { granted = true }).Ok();
        await client.PutAsJsonAsync($"{Path}/optional/push", new { granted = false }).Ok();
        var userId = await _factory.UserIdAsync(subject);
        Assert.Equal((2, 3), await CountsAsync(userId));

        await client.DeleteAsync("/api/v1/me").Ok();

        Assert.Equal((0, 0), await CountsAsync(userId));
    }

    private Task<(int Records, int History)> CountsAsync(Guid userId) =>
        _factory.QueryAsync(async context => (await context.UserConsents.CountAsync(row => row.UserId == userId), await context.UserConsentHistory.CountAsync(row => row.UserId == userId)));
}
