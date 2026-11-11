using System.Globalization;
using System.Net;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Endpoints;

/// <summary><c>GET /babies/{id}/rhythm</c> (docs/design/48-baby-rhythm.md) with synthetic babies only; now is 2026-01-29 15:00 in São Paulo.</summary>
public sealed class RhythmEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly TimeSpan SaoPaulo = TimeSpan.FromHours(-3);
    private static readonly DateTimeOffset Now = Local(29, 15);
    private const string Zone = "?utcOffsetMinutes=-180&timeZone=America/Sao_Paulo";

    private static DateTimeOffset Local(int day, int hour, int minute = 0) => new(2026, 1, day, hour, minute, 0, SaoPaulo);

    private static string PathFor(Guid babyId) => $"/api/v1/babies/{babyId}/rhythm";

    [Fact]
    public async Task Get_Viewer_ReturnsTheRhythmWithoutTheDeletedNight()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var deleted = Night(baby.BabyId, ownerId, 15, 22, 0, 480).ToArray();
        Array.ForEach(deleted, item => item.SoftDelete(Now.AddDays(-1)));
        await SeedAsync(Enumerable.Range(20, 7).SelectMany(evening => Night(baby.BabyId, ownerId, evening, 20, 0, 630)).Concat(deleted));

        var response = await ClientFor(baby.SubjectOf(BabyRole.Viewer)).GetAsync(PathFor(baby.BabyId) + Zone);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = body.RootElement;
        Assert.Equal(baby.BabyId, root.GetProperty("babyId").GetGuid());
        Assert.Equal(Now.ToUniversalTime(), root.GetProperty("generatedAt").GetDateTimeOffset());
        Assert.Equal(("America/Sao_Paulo", "2026-01-01", "2026-01-28", 7), (root.GetProperty("timeZone").GetString(), root.GetProperty("firstDay").GetString(), root.GetProperty("lastDay").GetString(), root.GetProperty("nights").GetInt32()));
        var bedTime = root.GetProperty("bedTime");
        Assert.Equal(("ok", "20:00", 0, 7), (bedTime.GetProperty("status").GetString(), bedTime.GetProperty("usual").GetString(), bedTime.GetProperty("spreadMinutes").GetInt32(), bedTime.GetProperty("nights").GetInt32()));
        Assert.Equal("06:30", root.GetProperty("wakeUp").GetProperty("usual").GetString());
        var night = root.GetProperty("nightLength");
        Assert.Equal(("ok", 7, 630, 630, 630), (night.GetProperty("status").GetString(), night.GetProperty("count").GetInt32(), night.GetProperty("p25Minutes").GetInt32(), night.GetProperty("medianMinutes").GetInt32(), night.GetProperty("p75Minutes").GetInt32()));
        Assert.Equal(630, root.GetProperty("longestStretch").GetProperty("medianMinutes").GetInt32());
        Assert.Equal(630, root.GetProperty("firstStretch").GetProperty("medianMinutes").GetInt32());
        var naps = root.GetProperty("naps");
        Assert.Equal(("not_enough_data", 6, JsonValueKind.Null, 0), (naps.GetProperty("status").GetString(), naps.GetProperty("count").GetInt32(), naps.GetProperty("median").ValueKind, naps.GetProperty("usualStarts").GetArrayLength()));
        var feeds = root.GetProperty("feeds");
        Assert.Equal(("not_enough_data", 0, "not_enough_data"), (feeds.GetProperty("status").GetString(), feeds.GetProperty("count").GetInt32(), feeds.GetProperty("gap").GetProperty("status").GetString()));
        var rule = root.GetProperty("rule");
        Assert.Equal((28, "04:00", 5, 5, 10, 90), (rule.GetProperty("lookBackDays").GetInt32(), rule.GetProperty("eveningDayStartsAt").GetString(), rule.GetProperty("minimumNights").GetInt32(), rule.GetProperty("minimumDays").GetInt32(), rule.GetProperty("minimumFeedGaps").GetInt32(), rule.GetProperty("maximumClockSpreadMinutes").GetInt32()));
        Assert.Equal((180, 960, 480, 240, 7, 20), (rule.GetProperty("minimumNightMinutes").GetInt32(), rule.GetProperty("maximumNightMinutes").GetInt32(), rule.GetProperty("maximumFeedGapMinutes").GetInt32(), rule.GetProperty("eveningFeedWindowMinutes").GetInt32(), rule.GetProperty("minimumGroupNights").GetInt32(), rule.GetProperty("minimumDifferenceMinutes").GetInt32()));
    }

    [Fact]
    public async Task Get_LongerNightsAfterMoreEveningFeeds_ReturnsTheAssociation()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var events = Enumerable.Range(1, 28).SelectMany(evening => evening % 2 == 1
            ? Night(baby.BabyId, ownerId, evening, 20, 0, 660).Concat(new[] { 17, 18, 19 }.Select(hour => Feed(baby.BabyId, ownerId, Local(evening, hour))))
            : Night(baby.BabyId, ownerId, evening, 20, 0, 600).Append(Feed(baby.BabyId, ownerId, Local(evening, 19))));
        await SeedAsync(events);

        var response = await ClientFor(baby.OwnerSubject).GetAsync(PathFor(baby.BabyId) + Zone);

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var associations = body.RootElement.GetProperty("associations").EnumerateArray().ToArray();
        Assert.Equal(["evening_feeds", "dirty_diaper_day"], associations.Select(association => association.GetProperty("factor").GetString()));
        Assert.Equal(2, associations[0].GetProperty("threshold").GetInt32());
        Assert.Equal(JsonValueKind.Null, associations[1].GetProperty("threshold").ValueKind);
        var outcomes = associations[0].GetProperty("outcomes").EnumerateArray().ToArray();
        Assert.Equal(["night_length", "longest_stretch", "first_stretch"], outcomes.Select(outcome => outcome.GetProperty("outcome").GetString()));
        var night = outcomes[0];
        Assert.Equal(("ok", 14, 14), (night.GetProperty("status").GetString(), night.GetProperty("nightsWith").GetInt32(), night.GetProperty("nightsWithout").GetInt32()));
        Assert.Equal((660, 600, 60, 30), (night.GetProperty("medianWithMinutes").GetInt32(), night.GetProperty("medianWithoutMinutes").GetInt32(), night.GetProperty("differenceMinutes").GetInt32(), night.GetProperty("spreadMinutes").GetInt32()));
        var dirty = associations[1].GetProperty("outcomes")[0];
        Assert.Equal(("not_enough_data", 0, 0, JsonValueKind.Null, JsonValueKind.Null), (dirty.GetProperty("status").GetString(), dirty.GetProperty("nightsWith").GetInt32(), dirty.GetProperty("nightsWithout").GetInt32(), dirty.GetProperty("medianWithMinutes").ValueKind, dirty.GetProperty("spreadMinutes").ValueKind));
        var feeds = body.RootElement.GetProperty("feeds");
        Assert.Equal(("ok", 28, 1, 2.0, 3), (feeds.GetProperty("status").GetString(), feeds.GetProperty("count").GetInt32(), feeds.GetProperty("p25").GetInt32(), feeds.GetProperty("median").GetDouble(), feeds.GetProperty("p75").GetInt32()));
    }

    [Fact]
    public async Task Get_BabyWithoutEvents_ReturnsEveryMetricWithoutData()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await ClientFor(baby.OwnerSubject).GetAsync(PathFor(baby.BabyId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = body.RootElement;
        Assert.Equal((0, JsonValueKind.Null), (root.GetProperty("nights").GetInt32(), root.GetProperty("timeZone").ValueKind));
        foreach (var metric in new[] { "bedTime", "wakeUp", "nightLength", "longestStretch", "firstStretch", "naps", "feeds" })
        {
            Assert.Equal("not_enough_data", root.GetProperty(metric).GetProperty("status").GetString());
        }

        Assert.Equal(JsonValueKind.Null, root.GetProperty("bedTime").GetProperty("usual").ValueKind);
        Assert.Equal(2, root.GetProperty("associations").GetArrayLength());
        Assert.All(root.GetProperty("associations").EnumerateArray(), association => Assert.Equal(3, association.GetProperty("outcomes").GetArrayLength()));
    }

    [Fact]
    public async Task Get_UnknownTimeZone_FallsBackToTheOffset()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await ClientFor(baby.OwnerSubject).GetAsync($"{PathFor(baby.BabyId)}?utcOffsetMinutes=-180&timeZone=Mars/Olympus_Mons");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("timeZone").ValueKind);
    }

    [Theory]
    [InlineData(-841)]
    [InlineData(841)]
    public async Task Get_UtcOffsetOutOfRange_Returns400(int offsetMinutes)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(baby.OwnerSubject).GetAsync(
            string.Create(CultureInfo.InvariantCulture, $"{PathFor(baby.BabyId)}?utcOffsetMinutes={offsetMinutes}"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("utcOffsetMinutes", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Get_DoctorWithTheDailyLog_Returns200_WithoutIt403()
    {
        var withLog = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.DailyLog]), BabyRole.Doctor);
        var growthOnly = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.Growth]), BabyRole.Doctor);

        var allowed = await factory.CreateClientFor(withLog.SubjectOf(BabyRole.Doctor)).GetAsync(PathFor(withLog.BabyId));
        var refused = await factory.CreateClientFor(growthOnly.SubjectOf(BabyRole.Doctor)).GetAsync(PathFor(growthOnly.BabyId));

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.Forbidden), (allowed.StatusCode, refused.StatusCode));
    }

    [Fact]
    public async Task Get_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(PathFor(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Get_UnknownBaby_Returns403()
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(PathFor(Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Get_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().GetAsync(PathFor(baby.BabyId));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    private static IEnumerable<Event> Night(Guid babyId, Guid ownerId, int evening, int hour, int minute, int minutes)
    {
        var bedTime = Local(evening, hour, minute);
        return [Marker(babyId, ownerId, "bed_time", bedTime), Marker(babyId, ownerId, "woke_up", bedTime.AddMinutes(minutes))];
    }

    private static Event Marker(Guid babyId, Guid ownerId, string kind, DateTimeOffset at) =>
        Event.Create(Guid.NewGuid(), babyId, BuiltInEventTypes.SleepId, ownerId, at, at, EventPayload.From($$"""{"kind":"{{kind}}"}"""), null, DateTimeOffset.UtcNow);

    private static Event Feed(Guid babyId, Guid ownerId, DateTimeOffset at) =>
        Event.Create(Guid.NewGuid(), babyId, BuiltInEventTypes.FeedingId, ownerId, at, at.AddMinutes(15), EventPayload.From("""{"method":"breast"}"""), null, DateTimeOffset.UtcNow);

    private Task SeedAsync(IEnumerable<Event> events) => factory.SeedAsync(context =>
    {
        context.Events.AddRange(events);
        return Task.CompletedTask;
    });

    private HttpClient ClientFor(string subject)
    {
        var client = WithClock().CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        return client;
    }

    private WebApplicationFactory<Program> WithClock() =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(new FixedTimeProvider(Now))));
}
