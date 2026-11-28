using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.CommunityInsights;
using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Users;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.Net.Http.Headers;

namespace Lotties.Api.Tests.CommunityInsights;

/// <summary>The API with a fixed clock, so a seeded birth date gives a known age in completed weeks.</summary>
public sealed class CommunityStatisticsApiFactory : ApiFactory
{
    public static readonly DateTimeOffset Now = new(2026, 11, 27, 12, 0, 0, TimeSpan.Zero);

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services => services.Replace(ServiceDescriptor.Singleton<TimeProvider>(new FixedTimeProvider(Now))));
    }
}

/// <summary>
/// <c>GET /babies/{babyId}/community-statistics</c> (docs/design/34-community-insights.md section 6 "Serving"): who is served, the
/// consent of that baby, the states of the release, the cells of her age (fine, coarse fallback, crying withheld below "100+"), two
/// babies of one parent, and the cache validator. The role of every caller is also in <c>EndpointRoleMatrixTests</c>.
/// </summary>
public sealed class CommunityStatisticsEndpointTests(CommunityStatisticsApiFactory factory) : IClassFixture<CommunityStatisticsApiFactory>
{
    private const string DemoSigningKey = "unit-test-demo-signing-key-0123456789-abcdef";

    private static readonly DateOnly Today = DateOnly.FromDateTime(CommunityStatisticsApiFactory.Now.UtcDateTime);

    /// <summary>Generated in 2026-Q4, so its percentile statistics read 2026-07-01 to 2026-09-30.</summary>
    private static readonly DateTimeOffset Generated = new(2026, 10, 2, 3, 0, 0, TimeSpan.Zero);

    private static string PathOf(Guid babyId) => $"/api/v1/babies/{babyId}/community-statistics";

    private static DateOnly BornWeeksAgo(int weeks) => Today.AddDays(-(weeks * 7) - 2);

    private int CatalogVersion => factory.Services.GetRequiredService<ICommunityStatisticsCatalogProvider>().Catalog.Version;

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public async Task FamilyMember_IsServedTheSameAnswer(BabyRole role)
    {
        await SeedReleaseAsync(MixedRelease());
        var baby = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);

        var owners = await (await Client(baby, BabyRole.Owner).GetAsync(PathOf(baby.BabyId))).Content.ReadAsStringAsync();
        var response = await Client(baby, role).GetAsync(PathOf(baby.BabyId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(owners, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Doctor_OfAnOptedInBaby_Is403()
    {
        await SeedReleaseAsync(MixedRelease());
        var baby = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);

        var response = await Client(baby, BabyRole.Doctor).GetAsync(PathOf(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.DoesNotContain("statistics", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task NonMember_AndAMemberOfAnotherBaby_Are403()
    {
        await SeedReleaseAsync(MixedRelease());
        var baby = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);
        var other = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);

        var stranger = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(PathOf(baby.BabyId));
        var otherFamily = await Client(other, BabyRole.Owner).GetAsync(PathOf(baby.BabyId));

        Assert.Equal((HttpStatusCode.Forbidden, HttpStatusCode.Forbidden), (stranger.StatusCode, otherFamily.StatusCode));
    }

    [Theory]
    [InlineData(Consent.None)]
    [InlineData(Consent.OlderText)]
    [InlineData(Consent.Withdrawn)]
    public async Task WithoutAConsentInForceUnderTheCurrentText_Is403ConsentRequired(Consent consent)
    {
        await SeedReleaseAsync(MixedRelease());
        var baby = await SeedBabyAsync(BornWeeksAgo(9), consent);

        foreach (var role in new[] { BabyRole.Owner, BabyRole.Viewer })
        {
            await (await Client(baby, role).GetAsync(PathOf(baby.BabyId))).AssertProblemAsync(HttpStatusCode.Forbidden, "community_consent_required");
        }
    }

    [Fact]
    public async Task AConsentOnAnotherBabyOfTheSameParent_DoesNotCount()
    {
        await SeedReleaseAsync(MixedRelease());
        var ownerSubject = TestUsers.NewSubject();
        await SeedBabyAsync(BornWeeksAgo(9), Consent.Current, ownerSubject);
        var withoutConsent = await SeedBabyAsync(BornWeeksAgo(30), Consent.None, ownerSubject);

        await (await Client(withoutConsent, BabyRole.Owner).GetAsync(PathOf(withoutConsent.BabyId))).AssertProblemAsync(HttpStatusCode.Forbidden, "community_consent_required");
    }

    [Fact]
    public async Task DemoUser_Is403()
    {
        using var host = factory.WithWebHostBuilder(builder => builder.UseSetting("Demo:SigningKey", DemoSigningKey));
        var started = await (await host.CreateClient().PostAsJsonAsync("/api/v1/demo/start", new { })).ReadAsync<JsonElement>();
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, new JsonWebTokenHandler().ReadJsonWebToken(started.GetProperty("accessToken").GetString()).Subject);
        client.DefaultRequestHeaders.Add(TestAuthHandler.IssuerHeader, User.DemoIssuer);

        await (await client.GetAsync(PathOf(started.GetProperty("babyId").GetGuid()))).AssertProblemAsync(HttpStatusCode.Forbidden, "demo_not_available");
    }

    [Fact]
    public async Task FlagOff_IsABare404ForEveryone()
    {
        var baby = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);
        using var disabled = factory.WithWebHostBuilder(builder => builder.UseSetting("CommunityInsights:Enabled", "false"));
        var owner = disabled.CreateClient();
        owner.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, baby.OwnerSubject);

        var responses = new[] { await owner.GetAsync(PathOf(baby.BabyId)), await disabled.CreateClient().GetAsync(PathOf(baby.BabyId)) };

        var noRoute = await owner.GetAsync("/api/v1/no-such-route");

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.NotFound, response.StatusCode));
        // Exactly what a route that does not exist answers: nothing tells the feature is there.
        foreach (var response in responses)
        {
            Assert.Equal(await noRoute.Content.ReadAsStringAsync(), await response.Content.ReadAsStringAsync());
        }
    }

    [Fact]
    public async Task NoRelease_IsNotYet()
    {
        await SeedReleaseAsync(json: null);
        var baby = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);

        Assert.Equal("""{"state":"not_yet","generatedAt":null,"previousQuarter":null,"statistics":[]}""", await GetTextAsync(baby));
    }

    [Fact]
    public async Task Placeholder_IsNotYet()
    {
        await SeedReleaseAsync(CommunityReleaseJson.Serialize(CommunityRelease.Placeholder(Generated, CatalogVersion)));
        var baby = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);

        Assert.Equal("not_yet", await StateAsync(baby));
    }

    [Theory]
    [InlineData("""{"schema":1,"cells":[],"generatedBy":"phase-1-placeholder"}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-10-02T03:00:00+00:00","catalogVersion":2,"placeholder":false,"statistics":[],"cells":[],"extra":1}""")]
    [InlineData("not json")]
    public async Task UnreadableRelease_IsNotYet(string json)
    {
        await SeedReleaseAsync(json);
        var baby = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);

        Assert.Equal("not_yet", await StateAsync(baby));
    }

    [Fact]
    public async Task ReleaseOfAnotherCatalogVersion_IsNotYet()
    {
        await SeedReleaseAsync(CommunityReleaseJson.Serialize(MixedReleaseModel() with { CatalogVersion = CatalogVersion + 1 }));
        var baby = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);

        Assert.Equal("not_yet", await StateAsync(baby));
    }

    /// <summary>
    /// A baby of 9 weeks: bottle and day sleep from her fine 4-week cell, tummy time from the coarse fallback (its fine 9-10 cell is
    /// absent), naps and night sleep absent, crying withheld (a "50-99" cell) and served exactly as absent.
    /// </summary>
    [Fact]
    public async Task Available_MixedPresentAndAbsentCells_CoarseFallback_CryingWithheld()
    {
        await SeedReleaseAsync(MixedRelease());
        var baby = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);

        Assert.Equal(
            """{"state":"available","generatedAt":"2026-10-02T03:00:00+00:00","previousQuarter":{"from":"2026-07-01","to":"2026-09-30"},"statistics":[{"key":"bottle_ml_per_feed","period":"previous_quarter","cell":{"band":{"fromWeeks":8,"toWeeks":12},"groupSize":"50-99","values":{"p25":110,"p50":130,"p75":150}}},{"key":"tummy_minutes_per_day","period":"since_consent","cell":{"band":{"fromWeeks":8,"toWeeks":12},"groupSize":"20-49","values":{"share_of_days_with_any":0.62}}},{"key":"naps_per_day","period":"previous_quarter","cell":null},{"key":"day_sleep_minutes","period":"previous_quarter","cell":{"band":{"fromWeeks":8,"toWeeks":12},"groupSize":"100+","values":{"p25":180,"p50":220,"p75":260}}},{"key":"night_sleep_minutes","period":"previous_quarter","cell":null},{"key":"cry_outcome_by_cause","period":"since_consent","cell":null}]}""",
            await GetTextAsync(baby));
    }

    [Fact]
    public async Task Crying_IsServedFromAHundredOrMore()
    {
        await SeedReleaseAsync(MixedRelease());
        var baby = await SeedBabyAsync(BornWeeksAgo(30), consent: Consent.Current);

        var cry = Statistic(await GetJsonAsync(baby), "cry_outcome_by_cause").GetProperty("cell");

        Assert.Equal(("100+", 26, 104), (cry.GetProperty("groupSize").GetString(), cry.GetProperty("band").GetProperty("fromWeeks").GetInt32(), cry.GetProperty("band").GetProperty("toWeeks").GetInt32()));
        Assert.Equal(["share_helped_by_cause.comfort", "share_helped_by_cause.hunger"], cry.GetProperty("values").EnumerateObject().Select(value => value.Name));
    }

    [Fact]
    public async Task NotBornYetOrOlderThanTheGrid_IsAvailableWithNoCells()
    {
        await SeedReleaseAsync(MixedRelease());
        var old = await SeedBabyAsync(BornWeeksAgo(120), consent: Consent.Current);

        var body = await GetJsonAsync(old);

        Assert.Equal("available", body.GetProperty("state").GetString());
        Assert.All(body.GetProperty("statistics").EnumerateArray(), statistic => Assert.Equal(JsonValueKind.Null, statistic.GetProperty("cell").ValueKind));
    }

    [Fact]
    public async Task TwoBabiesOfOneParent_GetTheirOwnBands_AndDistinctValidators()
    {
        await SeedReleaseAsync(MixedRelease());
        var ownerSubject = TestUsers.NewSubject();
        var younger = await SeedBabyAsync(BornWeeksAgo(9), Consent.Current, ownerSubject);
        var older = await SeedBabyAsync(BornWeeksAgo(30), Consent.Current, ownerSubject);
        var client = factory.CreateClientFor(ownerSubject);

        var first = await client.GetAsync(PathOf(younger.BabyId));
        var second = await client.GetAsync(PathOf(older.BabyId));
        var crossed = new HttpRequestMessage(HttpMethod.Get, PathOf(older.BabyId));
        crossed.Headers.TryAddWithoutValidation(HeaderNames.IfNoneMatch, first.Headers.ETag!.ToString());
        var withTheOthersValidator = await client.SendAsync(crossed);

        Assert.Equal(8, BottleBandFrom(await first.ReadAsync<JsonElement>()));
        Assert.Equal(28, BottleBandFrom(await second.ReadAsync<JsonElement>()));
        Assert.NotEqual(first.Headers.ETag, second.Headers.ETag);
        Assert.Equal(HttpStatusCode.OK, withTheOthersValidator.StatusCode);
    }

    [Fact]
    public async Task TwoBabiesWithTheSameAnswer_StillHaveDistinctValidators()
    {
        await SeedReleaseAsync(json: null);
        var first = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);
        var second = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);

        var a = await Client(first, BabyRole.Owner).GetAsync(PathOf(first.BabyId));
        var b = await Client(second, BabyRole.Owner).GetAsync(PathOf(second.BabyId));

        Assert.Equal(await a.Content.ReadAsStringAsync(), await b.Content.ReadAsStringAsync());
        Assert.NotEqual(a.Headers.ETag, b.Headers.ETag);
    }

    [Fact]
    public async Task Caching_PrivateShort_304OnAMatch_AndANewValidatorWithANewRelease()
    {
        await SeedReleaseAsync(MixedRelease());
        var baby = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);
        var client = Client(baby, BabyRole.Owner);

        var first = await client.GetAsync(PathOf(baby.BabyId));
        var again = await client.SendAsync(Conditional(baby, first.Headers.ETag!.ToString()));
        await SeedReleaseAsync(CommunityReleaseJson.Serialize(MixedReleaseModel() with { GeneratedAt = Generated.AddHours(1) }));
        var afterNewRelease = await client.SendAsync(Conditional(baby, first.Headers.ETag!.ToString()));

        Assert.Equal((true, TimeSpan.FromMinutes(5), false), (first.Headers.CacheControl!.Private, first.Headers.CacheControl.MaxAge, first.Headers.CacheControl.Public));
        Assert.Contains("Authorization", first.Headers.Vary);
        Assert.False(first.Headers.ETag!.IsWeak);
        Assert.Equal(HttpStatusCode.NotModified, again.StatusCode);
        Assert.Equal(HttpStatusCode.OK, afterNewRelease.StatusCode);
        Assert.NotEqual(first.Headers.ETag, afterNewRelease.Headers.ETag);
    }

    [Fact]
    public async Task OldRoute_IsGone()
    {
        var baby = await SeedBabyAsync(BornWeeksAgo(9), consent: Consent.Current);

        var response = await Client(baby, BabyRole.Owner).GetAsync("/api/v1/community/statistics/tummy_minutes_per_day");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    public enum Consent
    {
        None,
        Current,
        OlderText,
        Withdrawn,
    }

    private static int BottleBandFrom(JsonElement body) =>
        Statistic(body, "bottle_ml_per_feed").GetProperty("cell").GetProperty("band").GetProperty("fromWeeks").GetInt32();

    private static JsonElement Statistic(JsonElement body, string key) =>
        body.GetProperty("statistics").EnumerateArray().Single(statistic => statistic.GetProperty("key").GetString() == key);

    private static HttpRequestMessage Conditional(SeededBaby baby, string etag)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, PathOf(baby.BabyId));
        request.Headers.TryAddWithoutValidation(HeaderNames.IfNoneMatch, etag);
        return request;
    }

    private HttpClient Client(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private async Task<string> GetTextAsync(SeededBaby baby)
    {
        var response = await Client(baby, BabyRole.Owner).GetAsync(PathOf(baby.BabyId));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadAsStringAsync();
    }

    private async Task<JsonElement> GetJsonAsync(SeededBaby baby) => await (await Client(baby, BabyRole.Owner).GetAsync(PathOf(baby.BabyId))).ReadAsync<JsonElement>();

    private async Task<string?> StateAsync(SeededBaby baby) => (await GetJsonAsync(baby)).GetProperty("state").GetString();

    private CommunityRelease MixedReleaseModel()
    {
        var catalog = factory.Services.GetRequiredService<ICommunityStatisticsCatalogProvider>().Catalog;
        return new CommunityRelease(
            Generated,
            catalog.Version,
            IsPlaceholder: false,
            [.. catalog.InV1.Select(statistic => new CommunityReleaseStatistic(statistic.Key, statistic.K, statistic.Epsilon!.Value))],
            [
                Cell("bottle_ml_per_feed", 8, 12, CommunityGroupSize.Babies50To99, ("p25", 110m), ("p50", 130m), ("p75", 150m)),
                Cell("bottle_ml_per_feed", 28, 32, CommunityGroupSize.Babies20To49, ("p25", 160m), ("p50", 190m), ("p75", 220m)),
                Cell("tummy_minutes_per_day", 8, 12, CommunityGroupSize.Babies20To49, ("share_of_days_with_any", 0.62m)),
                Cell("day_sleep_minutes", 8, 12, CommunityGroupSize.Babies100Plus, ("p25", 180m), ("p50", 220m), ("p75", 260m)),
                Cell("cry_outcome_by_cause", 6, 13, CommunityGroupSize.Babies50To99, ("share_helped_by_cause.hunger", 0.5m), ("share_helped_by_cause.comfort", 0.5m)),
                Cell("cry_outcome_by_cause", 26, 104, CommunityGroupSize.Babies100Plus, ("share_helped_by_cause.hunger", 0.3m), ("share_helped_by_cause.comfort", 0.7m)),
            ]);
    }

    private string MixedRelease() => CommunityReleaseJson.Serialize(MixedReleaseModel());

    private static CommunityReleaseCell Cell(string statistic, int from, int to, CommunityGroupSize babies, params (string Name, decimal Value)[] values) =>
        new(statistic, new CommunityBand(from, to), null, values.ToDictionary(value => value.Name, value => value.Value, StringComparer.Ordinal), babies);

    /// <summary>Replaces every stored release by one active release with <paramref name="json"/> (none when null): the tests share one database.</summary>
    private Task SeedReleaseAsync(string? json) =>
        factory.SeedAsync(async context =>
        {
            context.CommunityStatisticsReleases.RemoveRange(await context.CommunityStatisticsReleases.ToListAsync());
            if (json is not null)
            {
                var release = CommunityStatisticsRelease.CreatePending("2026-W40", 1, json, Generated);
                release.Activate();
                context.CommunityStatisticsReleases.Add(release);
            }
        });

    /// <summary>A baby born on <paramref name="birthDate"/> with one member of every role, and her community insights consent as <paramref name="consent"/>.</summary>
    private async Task<SeededBaby> SeedBabyAsync(DateOnly birthDate, Consent consent, string? ownerSubject = null)
    {
        var now = CommunityStatisticsApiFactory.Now.AddDays(-1);
        var existingOwner = ownerSubject is null ? null : await factory.QueryAsync(context => context.Users.SingleOrDefaultAsync(user => user.Subject == ownerSubject));
        var owner = existingOwner ?? User.Create(User.UnknownIssuer, ownerSubject ?? TestUsers.NewSubject(), "Owner", now);
        var roles = new[] { BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor };
        var members = roles.Select(role => (Role: role, User: User.Create(User.UnknownIssuer, TestUsers.NewSubject(), role.ToString(), now))).ToArray();
        var baby = Baby.Create("Lia", birthDate, owner.Id, now);
        Array.ForEach(members, member => baby.AddMember(member.User.Id, member.Role, now));
        await factory.SeedAsync(context =>
        {
            if (existingOwner is null)
            {
                context.Users.Add(owner);
            }

            context.Users.AddRange(members.Select(member => member.User));
            context.Babies.Add(baby);
            context.CommunityConsents.AddRange(ConsentLines(baby.Id, owner.Id, consent, now));
            return Task.CompletedTask;
        });
        return new SeededBaby(baby.Id, owner.Subject, members.ToDictionary(member => member.Role, member => member.User.Subject));
    }

    private static IEnumerable<CommunityConsentEntry> ConsentLines(Guid babyId, Guid ownerId, Consent consent, DateTimeOffset at) => consent switch
    {
        Consent.Current => [CommunityConsentEntry.Grant(babyId, ownerId, CommunityConsentTexts.CurrentTextVersion, true, "test-policy", "en", at)],
        Consent.OlderText => [CommunityConsentEntry.Rehydrate(Guid.NewGuid(), babyId, ownerId, CommunityConsentAction.Granted, "ci-1", "test-policy", CommunityConsentTexts.V1Scopes, true, "en", at)],
        Consent.Withdrawn =>
        [
            CommunityConsentEntry.Grant(babyId, ownerId, CommunityConsentTexts.CurrentTextVersion, true, "test-policy", "en", at.AddHours(-2)),
            CommunityConsentEntry.Withdraw(babyId, ownerId, "test-policy", "en", at),
        ],
        _ => [],
    };
}
