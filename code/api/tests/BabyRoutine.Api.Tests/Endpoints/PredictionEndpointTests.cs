using System.Globalization;
using System.Net;
using System.Text.Json;
using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Predictions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BabyRoutine.Api.Tests.Endpoints;

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

        var history = await WithHistoryAsync(repository => repository.LoadAsync(seeded.Baby.BabyId, since));

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

        var history = await WithHistoryAsync(repository => repository.LoadAsync(baby.BabyId, bedTime.AddMinutes(-1)));

        Assert.Equal([SleepKinds.BedTime, null], history!.Events.OrderBy(item => item.StartedAt).Select(item => item.Kind));
    }

    [Fact]
    public async Task HistoryRepository_UnknownBaby_ReturnsNull()
    {
        Assert.Null(await WithHistoryAsync(repository => repository.LoadAsync(Guid.NewGuid(), DateTimeOffset.UtcNow)));
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

    private static Event NewEvent(Guid babyId, Guid ownerId, Guid typeId, DateTimeOffset start, DateTimeOffset end) =>
        Event.Create(Guid.NewGuid(), babyId, typeId, ownerId, start, end, EventPayload.Empty, null, DateTimeOffset.UtcNow);

    private async Task<TResult> WithHistoryAsync<TResult>(Func<IPredictionHistoryRepository, Task<TResult>> action)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<IPredictionHistoryRepository>());
    }

    private sealed record SeededHistory(SeededBaby Baby, int SessionCount, DateTimeOffset LastSessionStart, DateTimeOffset DeletedSessionStart);
}
