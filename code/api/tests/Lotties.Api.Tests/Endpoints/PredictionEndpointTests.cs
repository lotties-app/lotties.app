using System.Globalization;
using System.Net;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Endpoints;

public sealed class PredictionEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly TimeSpan SessionInterval = TimeSpan.FromHours(3);

    [Fact]
    public async Task Get_Member_ReturnsPredictionsAndInsufficientData()
    {
        var seeded = await SeedHistoryAsync();

        var response = await factory.CreateClientFor(seeded.Baby.SubjectOf(BabyRole.Viewer)).GetAsync(PathFor(seeded.Baby.BabyId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = body.RootElement;
        Assert.Equal(seeded.Baby.BabyId, root.GetProperty("babyId").GetGuid());
        Assert.True(root.TryGetProperty("generatedAt", out _));
        var tummyTime = Assert.Single(root.GetProperty("predictions").EnumerateArray());
        Assert.Equal("tummy_time", tummyTime.GetProperty("typeKey").GetString());
        var nextStart = tummyTime.GetProperty("nextStart");
        Assert.Equal(seeded.LastSessionStart + SessionInterval, nextStart.GetProperty("expected").GetDateTimeOffset());
        Assert.True(nextStart.TryGetProperty("earliest", out _));
        Assert.True(nextStart.TryGetProperty("latest", out _));
        Assert.Equal(20, tummyTime.GetProperty("expectedDuration").GetProperty("minutes").GetInt32());
        Assert.Equal("Medium", tummyTime.GetProperty("confidence").GetString());
        Assert.Equal(seeded.SessionCount - 1, tummyTime.GetProperty("sampleCount").GetInt32());
        Assert.StartsWith("Median every 3h over the last 14 days", tummyTime.GetProperty("reason").GetString());
        var basis = tummyTime.GetProperty("basis");
        Assert.Equal("StartInterval", basis.GetProperty("kind").GetString());
        Assert.Equal(180, basis.GetProperty("medianGapMinutes").GetInt32());
        Assert.Equal(14, basis.GetProperty("lookBackDays").GetInt32());
        Assert.False(basis.GetProperty("assumesEventInProgressEnds").GetBoolean());
        var diaper = Assert.Single(root.GetProperty("insufficientData").EnumerateArray());
        Assert.Equal("diaper", diaper.GetProperty("typeKey").GetString());
        Assert.Equal(0, diaper.GetProperty("sampleCount").GetInt32());
        Assert.Equal(3, diaper.GetProperty("requiredSamples").GetInt32());
    }

    [Fact]
    public async Task Get_Member_ReturnsEngineVersionAndNullBedTimeWithoutNights()
    {
        var seeded = await SeedHistoryAsync();

        var response = await factory.CreateClientFor(seeded.Baby.SubjectOf(BabyRole.Viewer)).GetAsync(PathFor(seeded.Baby.BabyId));

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("heuristic-1.1", body.RootElement.GetProperty("engineVersion").GetString());
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("bedTime").ValueKind);
    }

    [Fact]
    public async Task Get_WithUtcOffset_Returns200()
    {
        var seeded = await SeedHistoryAsync();

        var response = await factory.CreateClientFor(seeded.Baby.OwnerSubject).GetAsync($"{PathFor(seeded.Baby.BabyId)}?utcOffsetMinutes=-180");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
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
    }

    [Fact]
    public async Task Get_BabyWithoutEvents_ReturnsEmptyLists()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(baby.OwnerSubject).GetAsync(PathFor(baby.BabyId));

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, body.RootElement.GetProperty("predictions").GetArrayLength());
        Assert.Equal(0, body.RootElement.GetProperty("insufficientData").GetArrayLength());
        Assert.Equal(0, body.RootElement.GetProperty("patterns").GetArrayLength());
    }

    [Fact]
    public async Task Get_BellyPainAtTheSameTimeOnSixDays_ReturnsThePatternInTheTimeZone()
    {
        var baby = await SeedBellyPainAsync(new TimeOnly(6, 0), days: 6);

        var response = await factory.CreateClientFor(baby.OwnerSubject).GetAsync($"{PathFor(baby.BabyId)}?utcOffsetMinutes=-180&timeZone=America/Sao_Paulo");

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var pattern = Assert.Single(body.RootElement.GetProperty("patterns").EnumerateArray());
        Assert.Equal("belly_pain", pattern.GetProperty("typeKey").GetString());
        Assert.Equal(("06:00", "05:30", "06:30", 60), (pattern.GetProperty("typicalClock").GetString(), pattern.GetProperty("windowStart").GetString(), pattern.GetProperty("windowEnd").GetString(), pattern.GetProperty("windowMinutes").GetInt32()));
        Assert.Equal(("Medium", 0, 6, 6), (pattern.GetProperty("confidence").GetString(), pattern.GetProperty("spreadMinutes").GetInt32(), pattern.GetProperty("eventDayCount").GetInt32(), pattern.GetProperty("recentDayCount").GetInt32()));
        Assert.Equal("America/Sao_Paulo", pattern.GetProperty("timeZone").GetString());
        var days = pattern.GetProperty("days").EnumerateArray().ToArray();
        Assert.Equal(6, days.Length);
        Assert.Equal(["06:00"], days[0].GetProperty("times").EnumerateArray().Select(time => time.GetString()));
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}$", days[0].GetProperty("date").GetString());
        var rule = pattern.GetProperty("rule");
        Assert.Equal((14, 7, 4, 45, 60, 45), (rule.GetProperty("lookBackDays").GetInt32(), rule.GetProperty("recentDays").GetInt32(), rule.GetProperty("minimumRecentDays").GetInt32(), rule.GetProperty("maximumSpreadMinutes").GetInt32(), rule.GetProperty("minimumCoveragePercent").GetInt32(), rule.GetProperty("leadMinutes").GetInt32()));
    }

    [Fact]
    public async Task Get_UnknownTimeZone_FallsBackToTheOffset()
    {
        var baby = await SeedBellyPainAsync(new TimeOnly(6, 0), days: 5);

        var response = await factory.CreateClientFor(baby.OwnerSubject).GetAsync($"{PathFor(baby.BabyId)}?utcOffsetMinutes=-180&timeZone=Mars/Olympus_Mons");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var pattern = Assert.Single(body.RootElement.GetProperty("patterns").EnumerateArray());
        Assert.Equal("06:00", pattern.GetProperty("typicalClock").GetString());
        Assert.Equal(JsonValueKind.Null, pattern.GetProperty("timeZone").ValueKind);
    }

    [Fact]
    public async Task Get_BellyPainOnThreeDays_ReturnsNoPattern()
    {
        var baby = await SeedBellyPainAsync(new TimeOnly(6, 0), days: 3);

        var response = await factory.CreateClientFor(baby.OwnerSubject).GetAsync($"{PathFor(baby.BabyId)}?utcOffsetMinutes=-180&timeZone=America/Sao_Paulo");

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, body.RootElement.GetProperty("patterns").GetArrayLength());
    }

    [Fact]
    public async Task Get_DaytimeAwakeStretches_ReturnsTheWakeWindowAndTheCurrentStretch()
    {
        var now = new DateTimeOffset(2026, 1, 10, 15, 0, 0, SaoPaulo);
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var ninth = now.AddDays(-1).Date;
        var naps = new[] { (6, 0, 60), (8, 40, 30), (11, 0, 30), (13, 30, 30), (16, 10, 30), (19, 0, 30) }
            .Select(nap => new DateTimeOffset(ninth.AddHours(nap.Item1).AddMinutes(nap.Item2), SaoPaulo))
            .Zip([60, 30, 30, 30, 30, 30], (start, minutes) => Nap(baby.BabyId, ownerId, start, start.AddMinutes(minutes)))
            .Append(Nap(baby.BabyId, ownerId, now.AddHours(-3), now.AddHours(-2)))
            .ToArray();
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(naps);
            return Task.CompletedTask;
        });

        var response = await ClientFor(WithClock(now), baby.OwnerSubject).GetAsync($"{PathFor(baby.BabyId)}?utcOffsetMinutes=-180&timeZone=America/Sao_Paulo");

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var wake = body.RootElement.GetProperty("wakeWindow");
        Assert.Equal((130, 5, 120), (wake.GetProperty("limitMinutes").GetInt32(), wake.GetProperty("sampleCount").GetInt32(), wake.GetProperty("awakeMinutes").GetInt32()));
        Assert.Equal(now.AddHours(-2), wake.GetProperty("awakeSince").GetDateTimeOffset());
        Assert.Equal("America/Sao_Paulo", wake.GetProperty("timeZone").GetString());
        var stretches = wake.GetProperty("stretches").EnumerateArray().ToArray();
        Assert.Equal([100, 110, 120, 130, 140], stretches.Select(stretch => stretch.GetProperty("minutes").GetInt32()));
        Assert.Equal(new DateTimeOffset(ninth.AddHours(7), SaoPaulo), stretches[0].GetProperty("start").GetDateTimeOffset());
        var rule = wake.GetProperty("rule");
        Assert.Equal((14, "05:00", "18:00", 75, 5, 15, 30), (rule.GetProperty("lookBackDays").GetInt32(), rule.GetProperty("dayStartsAt").GetString(), rule.GetProperty("dayEndsAt").GetString(), rule.GetProperty("percentile").GetInt32(), rule.GetProperty("minimumStretches").GetInt32(), rule.GetProperty("leadMinutes").GetInt32(), rule.GetProperty("graceMinutes").GetInt32()));
    }

    [Fact]
    public async Task Get_TooFewAwakeStretches_ReturnsANullWakeWindow()
    {
        var seeded = await SeedHistoryAsync();

        var response = await factory.CreateClientFor(seeded.Baby.OwnerSubject).GetAsync(PathFor(seeded.Baby.BabyId));

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("wakeWindow").ValueKind);
    }

    [Fact]
    public async Task Get_FussySpellsAtTheSameTimeOnSixDays_ReturnsTheFussyPattern()
    {
        var baby = await SeedSpellsAsync(BuiltInEventTypes.FussyId, new TimeOnly(18, 0), days: 6, """{"intensity":"mild"}""");

        var response = await factory.CreateClientFor(baby.OwnerSubject).GetAsync($"{PathFor(baby.BabyId)}?utcOffsetMinutes=-180&timeZone=America/Sao_Paulo");

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var pattern = Assert.Single(body.RootElement.GetProperty("patterns").EnumerateArray());
        Assert.Equal(("fussy", "18:00", "17:30", "18:30"), (pattern.GetProperty("typeKey").GetString(), pattern.GetProperty("typicalClock").GetString(), pattern.GetProperty("windowStart").GetString(), pattern.GetProperty("windowEnd").GetString()));
        Assert.Equal(45, pattern.GetProperty("rule").GetProperty("leadMinutes").GetInt32());
    }

    [Theory]
    [InlineData("""{"auto_detected":true,"cry_confirmed":false}""", 0)]
    [InlineData("""{"cry_confirmed":false}""", 0)]
    [InlineData("""{"auto_detected":true,"cry_confirmed":true}""", 1)]
    [InlineData("""{"auto_detected":true}""", 1)]
    public async Task Get_FussySpellsMarkedNotCrying_DoNotBuildTheFussyPattern(string payload, int patterns)
    {
        var baby = await SeedSpellsAsync(BuiltInEventTypes.FussyId, new TimeOnly(18, 0), days: 6, payload);

        var response = await factory.CreateClientFor(baby.OwnerSubject).GetAsync($"{PathFor(baby.BabyId)}?utcOffsetMinutes=-180&timeZone=America/Sao_Paulo");

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(patterns, body.RootElement.GetProperty("patterns").GetArrayLength());
    }

    [Fact]
    public async Task Get_WetDiapersAndDirtyOnesAfterFeeds_ReturnsTheDiaperPredictions()
    {
        var now = new DateTimeOffset(2026, 1, 10, 15, 0, 0, SaoPaulo);
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var wet = Enumerable.Range(0, 16)
            .Select(index => now.AddHours(-2 - (3 * index)))
            .Select(at => Event.Create(Guid.NewGuid(), baby.BabyId, BuiltInEventTypes.DiaperId, ownerId, at, at, EventPayload.From("""{"content":"WET"}"""), null, DateTimeOffset.UtcNow));
        var afterFeeds = Enumerable.Range(1, 5)
            .Select(daysAgo => new DateTimeOffset(2026, 1, 10 - daysAgo, 7, 0, 0, SaoPaulo))
            .SelectMany(feed => new[]
            {
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.FeedingId, feed, feed.AddMinutes(20)),
                Event.Create(Guid.NewGuid(), baby.BabyId, BuiltInEventTypes.DiaperId, ownerId, feed.AddMinutes(50), feed.AddMinutes(50), EventPayload.From("""{"content":"DIRTY"}"""), null, DateTimeOffset.UtcNow),
            });
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(wet.Concat(afterFeeds));
            return Task.CompletedTask;
        });

        var response = await ClientFor(WithClock(now), baby.OwnerSubject).GetAsync($"{PathFor(baby.BabyId)}?utcOffsetMinutes=-180&timeZone=America/Sao_Paulo");

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var diaper = body.RootElement.GetProperty("diaper");
        var wetPrediction = diaper.GetProperty("wet");
        Assert.Equal(now.AddHours(-2), wetPrediction.GetProperty("anchorAt").GetDateTimeOffset());
        Assert.Equal(now.AddHours(1), wetPrediction.GetProperty("nextStart").GetProperty("expected").GetDateTimeOffset());
        Assert.Equal((180, 16, 15, "Medium"), (wetPrediction.GetProperty("medianGapMinutes").GetInt32(), wetPrediction.GetProperty("eventCount").GetInt32(), wetPrediction.GetProperty("gapCount").GetInt32(), wetPrediction.GetProperty("confidence").GetString()));
        var dirty = diaper.GetProperty("dirty");
        Assert.Equal(new DateTimeOffset(2026, 1, 9, 7, 50, 0, SaoPaulo), dirty.GetProperty("lastDirtyAt").GetDateTimeOffset());
        Assert.Equal((1440, 5), (dirty.GetProperty("gap").GetProperty("medianGapMinutes").GetInt32(), dirty.GetProperty("gap").GetProperty("eventCount").GetInt32()));
        var lag = dirty.GetProperty("afterFeed");
        Assert.Equal((30, 30, 30, 5, "Low"), (lag.GetProperty("lowerLagMinutes").GetInt32(), lag.GetProperty("medianLagMinutes").GetInt32(), lag.GetProperty("upperLagMinutes").GetInt32(), lag.GetProperty("pairCount").GetInt32(), lag.GetProperty("confidence").GetString()));
        Assert.Equal(new DateTimeOffset(2026, 1, 9, 7, 20, 0, SaoPaulo), lag.GetProperty("latestFeedEndedAt").GetDateTimeOffset());
        var rule = diaper.GetProperty("rule");
        Assert.Equal((7, 8, 14, 5, 25, 75), (rule.GetProperty("wetLookBackDays").GetInt32(), rule.GetProperty("minimumWetEvents").GetInt32(), rule.GetProperty("dirtyLookBackDays").GetInt32(), rule.GetProperty("minimumDirtyEvents").GetInt32(), rule.GetProperty("lowerPercentile").GetInt32(), rule.GetProperty("upperPercentile").GetInt32()));
        Assert.Equal((180, 5, 40, 20, 40), (rule.GetProperty("feedWindowMinutes").GetInt32(), rule.GetProperty("minimumFeedPairs").GetInt32(), rule.GetProperty("maximumLagSpreadMinutes").GetInt32(), rule.GetProperty("leadMinutes").GetInt32(), rule.GetProperty("graceMinutes").GetInt32()));
    }

    [Fact]
    public async Task Get_TooFewDiapers_ReturnsNullDiaperParts()
    {
        var seeded = await SeedHistoryAsync();

        var response = await factory.CreateClientFor(seeded.Baby.OwnerSubject).GetAsync(PathFor(seeded.Baby.BabyId));

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var diaper = body.RootElement.GetProperty("diaper");
        Assert.Equal((JsonValueKind.Null, JsonValueKind.Null), (diaper.GetProperty("wet").ValueKind, diaper.GetProperty("dirty").ValueKind));
        Assert.Equal(8, diaper.GetProperty("rule").GetProperty("minimumWetEvents").GetInt32());
    }

    [Fact]
    public async Task Get_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(PathFor(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Get_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().GetAsync(PathFor(baby.BabyId));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task HistoryRepository_LoadsOnlyRecentNonDeletedEventsOfTheBaby()
    {
        var seeded = await SeedHistoryAsync();
        var other = await SeedHistoryAsync();
        var since = DateTimeOffset.UtcNow - PredictionOptions.Default.LookBack;

        var history = await LoadHistoryAsync(seeded.Baby.BabyId, since);

        Assert.Equal(DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), history!.BirthDate);
        Assert.Equal(seeded.SessionCount + 1, history.Events.Count);
        Assert.All(history.Events, item => Assert.True(item.StartedAt >= since));
        Assert.DoesNotContain(history.Events, item => item.StartedAt == seeded.DeletedSessionStart);
        Assert.NotEqual(seeded.Baby.BabyId, other.Baby.BabyId);
    }

    [Fact]
    public async Task HistoryRepository_ReadsThePayloadKind()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var bedTime = DateTimeOffset.UtcNow.AddHours(-3);
        await factory.SeedAsync(context =>
        {
            context.Events.Add(Event.Create(Guid.NewGuid(), baby.BabyId, BuiltInEventTypes.SleepId, ownerId, bedTime, bedTime, EventPayload.From("""{"kind":"bed_time","mood":"calm"}"""), null, DateTimeOffset.UtcNow));
            context.Events.Add(NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.SleepId, bedTime.AddHours(1), bedTime.AddHours(2)));
            return Task.CompletedTask;
        });

        var history = await LoadHistoryAsync(baby.BabyId, bedTime.AddMinutes(-1));

        Assert.Equal([SleepKinds.BedTime, null], history!.Events.OrderBy(item => item.StartedAt).Select(item => item.Kind));
    }

    [Fact]
    public async Task HistoryRepository_ReadsTheDiaperContent()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var changedAt = DateTimeOffset.UtcNow.AddHours(-1);
        await factory.SeedAsync(context =>
        {
            context.Events.Add(Event.Create(Guid.NewGuid(), baby.BabyId, BuiltInEventTypes.DiaperId, ownerId, changedAt, changedAt, EventPayload.From("""{"content":"MIXED"}"""), null, DateTimeOffset.UtcNow));
            return Task.CompletedTask;
        });

        var history = await LoadHistoryAsync(baby.BabyId, changedAt.AddMinutes(-1));

        Assert.Equal(DiaperContents.Mixed, Assert.Single(history!.Events).Content);
    }

    [Fact]
    public async Task HistoryRepository_UnknownBaby_ReturnsNull()
    {
        Assert.Null(await LoadHistoryAsync(Guid.NewGuid(), DateTimeOffset.UtcNow));
    }

    private static string PathFor(Guid babyId) => $"/api/v1/babies/{babyId}/predictions";

    /// <summary>
    /// Seeds a baby with tummy time every 3h over the last 3 days, one diaper, one soft-deleted session after the last real
    /// one and one session older than the look-back window.
    /// </summary>
    private async Task<SeededHistory> SeedHistoryAsync()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var ownerId = await factory.QueryAsync(context =>
            context.Users.Where(user => user.Subject == baby.OwnerSubject).Select(user => user.Id).SingleAsync());
        var now = DateTimeOffset.UtcNow;
        var sessions = Enumerable.Range(1, 24)
            .Select(index => now - (SessionInterval * index) + TimeSpan.FromMinutes(30))
            .Select(start => NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.TummyTimeId, start, start.AddMinutes(20)))
            .ToArray();
        var deletedSession = NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.TummyTimeId, now.AddMinutes(-5), now.AddMinutes(-1));
        deletedSession.SoftDelete(now);
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(sessions);
            context.Events.Add(NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.DiaperId, now.AddHours(-2), now.AddHours(-2)));
            context.Events.Add(NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.TummyTimeId, now.AddDays(-20), now.AddDays(-20).AddMinutes(20)));
            context.Events.Add(deletedSession);
            return Task.CompletedTask;
        });
        return new SeededHistory(baby, sessions.Length, sessions.Max(session => session.StartedAt), deletedSession.StartedAt);
    }

    private static readonly TimeSpan SaoPaulo = TimeSpan.FromHours(-3);

    private static Event Nap(Guid babyId, Guid ownerId, DateTimeOffset start, DateTimeOffset end) =>
        Event.Create(Guid.NewGuid(), babyId, BuiltInEventTypes.SleepId, ownerId, start, end, EventPayload.From("""{"kind":"nap"}"""), null, DateTimeOffset.UtcNow);

    private WebApplicationFactory<Program> WithClock(DateTimeOffset now) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(new FixedTimeProvider(now))));

    private static HttpClient ClientFor(WebApplicationFactory<Program> host, string subject)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        return client;
    }

    /// <summary>A baby with one event of <paramref name="typeId"/> (40 minutes) at the São Paulo time <paramref name="at"/> on each of the <paramref name="days"/> days before today.</summary>
    private async Task<SeededBaby> SeedSpellsAsync(Guid typeId, TimeOnly at, int days, string payload)
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var today = DateOnly.FromDateTime(DateTimeOffset.UtcNow.ToOffset(SaoPaulo).DateTime);
        var spells = Enumerable.Range(1, days)
            .Select(daysAgo => new DateTimeOffset(today.AddDays(-daysAgo).ToDateTime(at), SaoPaulo))
            .Select(start => Event.Create(Guid.NewGuid(), baby.BabyId, typeId, ownerId, start, start.AddMinutes(40), EventPayload.From(payload), null, DateTimeOffset.UtcNow))
            .ToArray();
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(spells);
            return Task.CompletedTask;
        });
        return baby;
    }

    /// <summary>A baby with one belly pain at the São Paulo (UTC-3) time <paramref name="at"/> on each of the <paramref name="days"/> days before today.</summary>
    private async Task<SeededBaby> SeedBellyPainAsync(TimeOnly at, int days)
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var saoPaulo = TimeSpan.FromHours(-3);
        var today = DateOnly.FromDateTime(DateTimeOffset.UtcNow.ToOffset(saoPaulo).DateTime);
        var pains = Enumerable.Range(1, days)
            .Select(daysAgo => new DateTimeOffset(today.AddDays(-daysAgo).ToDateTime(at), saoPaulo))
            .Select(start => Event.Create(Guid.NewGuid(), baby.BabyId, BuiltInEventTypes.BellyPainId, ownerId, start, start, EventPayload.From("""{"intensity":3}"""), null, DateTimeOffset.UtcNow))
            .ToArray();
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(pains);
            return Task.CompletedTask;
        });
        return baby;
    }

    private static Event NewEvent(Guid babyId, Guid ownerId, Guid typeId, DateTimeOffset start, DateTimeOffset end) =>
        Event.Create(Guid.NewGuid(), babyId, typeId, ownerId, start, end, EventPayload.Empty, null, DateTimeOffset.UtcNow);

    /// <summary>The repository in a scope of its own with the baby bound, as the predictions route binds it.</summary>
    private async Task<PredictionHistory?> LoadHistoryAsync(Guid babyId, DateTimeOffset since)
    {
        await using var scope = await factory.CreateScopeForAsync(babyId);
        return await scope.ServiceProvider.GetRequiredService<IPredictionHistoryRepository>().LoadAsync(babyId, since);
    }

    private sealed record SeededHistory(SeededBaby Baby, int SessionCount, DateTimeOffset LastSessionStart, DateTimeOffset DeletedSessionStart);
}
