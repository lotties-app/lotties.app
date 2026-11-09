using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Lotties.Api.Tests.Assistants;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.Clinical;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Rest;
using Lotties.Domain.Users;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Lotties.Api.Tests.Rest;

/// <summary>
/// <c>GET /me/rest/history</c> (docs/design/41-caregiver-rest.md "History"). The clock is fixed at Saturday 2026-01-10 12:00
/// UTC and the zone is UTC, so the last finished night is Friday 2026-01-09 and 14 nights start on 2025-12-27.
/// </summary>
public sealed class RestHistoryEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = "/api/v1/me/rest/history";
    private const string SettingsPath = "/api/v1/me/rest-settings";

    private sealed record Cast(Guid BabyId, User Mother, User Father, User Viewer);

    private static DateTimeOffset At(int day, int hour, int minute = 0) => new(2026, 1, day, hour, minute, 0, TimeSpan.Zero);

    private static User NewUser(string name) => User.Create(User.UnknownIssuer, TestUsers.NewSubject(), name, TestUsers.Now);

    private static Event Logged(Guid babyId, Guid by, Guid typeId, DateTimeOffset start, DateTimeOffset? end) =>
        Event.Create(Guid.NewGuid(), babyId, typeId, by, start, end, EventPayload.Empty, null, start);

    /// <summary>
    /// Weekday nights Monday 2026-01-05 to Friday 2026-01-09: the baby sleeps 21:00 to 06:30 the next day. On Friday the mother
    /// also logs feeds at 02:10 and 04:35 with the baby asleep again at 02:40 and 05:00 (the worked example of section 2).
    /// </summary>
    private async Task<Cast> SeedWeekAsync()
    {
        var cast = new Cast(Guid.Empty, NewUser("Mother"), NewUser("Father"), NewUser("Viewer"));
        var baby = Baby.Create("Lia", new DateOnly(2025, 6, 1), cast.Mother.Id, TestUsers.Now);
        baby.AddMember(cast.Father.Id, BabyRole.Parent, TestUsers.Now);
        baby.AddMember(cast.Viewer.Id, BabyRole.Viewer, TestUsers.Now);
        var sleep = BuiltInEventTypes.SleepId;
        var feeding = BuiltInEventTypes.FeedingId;
        var events = Enumerable.Range(5, 4).Select(day => Logged(baby.Id, cast.Mother.Id, sleep, At(day, 21), At(day + 1, 6, 30))).ToList();
        events.AddRange(
        [
            Logged(baby.Id, cast.Mother.Id, sleep, At(9, 21), At(10, 2, 5)),
            Logged(baby.Id, cast.Mother.Id, feeding, At(10, 2, 10), At(10, 2, 25)),
            Logged(baby.Id, cast.Mother.Id, sleep, At(10, 2, 40), At(10, 4, 30)),
            Logged(baby.Id, cast.Mother.Id, feeding, At(10, 4, 35), At(10, 4, 50)),
            Logged(baby.Id, cast.Mother.Id, sleep, At(10, 5), At(10, 6, 30)),
        ]);
        await factory.SeedAsync(context =>
        {
            context.Users.AddRange(cast.Mother, cast.Father, cast.Viewer);
            context.Babies.Add(baby);
            context.Events.AddRange(events);
            return Task.CompletedTask;
        });
        return cast with { BabyId = baby.Id };
    }

    private HttpClient As(User user) => factory.WithFixedClock().ClientFor(user.Subject);

    private static async Task TurnOnAsync(HttpClient client, object[]? workWindows = null) =>
        Assert.True((await client.PutAsJsonAsync(SettingsPath, new
        {
            enabled = true,
            timeZone = "UTC",
            workWindows = workWindows ?? [],
            nightStart = "19:00",
            nightEnd = "07:00",
            fallAsleepMinutes = 20,
            wakeLeadMinutes = 20,
        })).IsSuccessStatusCode);

    private async Task<JsonElement> HistoryAsync(User user, string query = "") =>
        await (await As(user).GetAsync(Path + query)).ReadAsync<JsonElement>();

    private static JsonElement Night(JsonElement history, string night) =>
        history.GetProperty("nights").EnumerateArray().Single(item => item.GetProperty("night").GetString() == night);

    private static string Time(JsonElement part, string name) => part.GetProperty(name).GetDateTimeOffset().ToString("HH:mm");

    [Fact]
    public async Task Default_Is14Nights_EndingAtTheLastFinishedNight_WithTheContractShape()
    {
        var cast = await SeedWeekAsync();
        await TurnOnAsync(As(cast.Father));

        var json = await HistoryAsync(cast.Father);

        Assert.Equal("ok", json.GetProperty("status").GetString());
        Assert.Equal(14, json.GetProperty("nightsRequested").GetInt32());
        var nights = json.GetProperty("nights").EnumerateArray().ToArray();
        Assert.Equal(14, nights.Length);
        Assert.Equal("2025-12-27", nights[0].GetProperty("night").GetString());
        Assert.Equal("2026-01-09", nights[^1].GetProperty("night").GetString());
        Assert.Equal("notEnoughLog", nights[0].GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, nights[0].GetProperty("confidence").ValueKind);
        var friday = nights[^1];
        Assert.Equal("ok", friday.GetProperty("status").GetString());
        Assert.Equal("low", friday.GetProperty("confidence").GetString());
        Assert.False(friday.GetProperty("workOverlap").GetBoolean());
        Assert.True(friday.GetProperty("counted").GetBoolean());
        var part = Assert.Single(friday.GetProperty("parts").EnumerateArray());
        Assert.Equal("21:20", Time(part, "start"));
        Assert.Equal("06:30", Time(part, "end"));
        Assert.Equal("babyFinalWake", part.GetProperty("endSource").GetString());

        var weekday = json.GetProperty("weekdayWeekend").GetProperty("weekday");
        Assert.Equal(5, weekday.GetProperty("countedNights").GetInt32());
        var minutes = weekday.GetProperty("restedMinutes");
        Assert.Equal(550, minutes.GetProperty("p25").GetInt32()); // 21:20 to 06:30 = 550 minutes every night
        Assert.Equal(550, minutes.GetProperty("median").GetInt32());
        Assert.Equal(550, minutes.GetProperty("p75").GetInt32());
        var weekend = json.GetProperty("weekdayWeekend").GetProperty("weekend");
        Assert.Equal(0, weekend.GetProperty("countedNights").GetInt32());
        Assert.Equal(JsonValueKind.Null, weekend.GetProperty("restedMinutes").ValueKind);

        var typical = json.GetProperty("typicalNight");
        Assert.Equal(5, typical.GetProperty("countedNights").GetInt32());
        var hours = typical.GetProperty("hours").EnumerateArray().ToArray();
        Assert.Equal(24, hours.Length);
        Assert.Equal(19, hours[0].GetProperty("hour").GetInt32());
        Assert.Equal(1, hours.Single(hour => hour.GetProperty("hour").GetInt32() == 3).GetProperty("share").GetDouble());
        Assert.Equal(0, hours.Single(hour => hour.GetProperty("hour").GetInt32() == 12).GetProperty("share").GetDouble());

        var constants = json.GetProperty("constants");
        Assert.Equal(20, constants.GetProperty("fallAsleepMinutes").GetInt32());
        Assert.Equal(20, constants.GetProperty("wakeLeadMinutes").GetInt32());
        Assert.Equal(RestHistoryBuilder.MinimumNights, constants.GetProperty("minimumNights").GetInt32());
        Assert.Equal(5, constants.GetProperty("minutesRounding").GetInt32());
        Assert.Equal(2, constants.GetProperty("shareDecimals").GetInt32());
        Assert.Equal(30, constants.GetProperty("asleepMinutesPerHour").GetInt32());
    }

    [Fact]
    public async Task TwentyEightNights_Returns28()
    {
        var cast = await SeedWeekAsync();
        await TurnOnAsync(As(cast.Father));

        var json = await HistoryAsync(cast.Father, "?nights=28");

        Assert.Equal(28, json.GetProperty("nightsRequested").GetInt32());
        Assert.Equal(28, json.GetProperty("nights").GetArrayLength());
        Assert.Equal("2025-12-13", json.GetProperty("nights")[0].GetProperty("night").GetString());
    }

    [Theory]
    [InlineData("?nights=7")]
    [InlineData("?nights=15")]
    [InlineData("?nights=0")]
    [InlineData("?nights=-14")]
    [InlineData("?nights=+14")]
    [InlineData("?nights=14.0")]
    [InlineData("?nights=abc")]
    [InlineData("?nights=%2014")]
    public async Task BadNights_Is400WithTheField(string query)
    {
        var user = NewUser("Bad");
        await factory.SeedAsync(context =>
        {
            context.Users.Add(user);
            return Task.CompletedTask;
        });

        var problem = await (await As(user).GetAsync(Path + query)).AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");

        Assert.Equal("nights", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Disabled_ReturnsDisabled_WithoutReadingAnyBabyEventOrMorning()
    {
        var user = NewUser("Off");
        await factory.SeedAsync(context =>
        {
            context.Users.Add(user);
            return Task.CompletedTask;
        });
        using var host = factory.WithFixedClock().WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddScoped(_ => Throwing<IClinicalEventRepository>());
            services.AddScoped(_ => Throwing<IBabyRepository>());
        }));

        var response = await host.ClientFor(user.Subject).GetAsync(Path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await response.ReadAsync<JsonElement>();
        Assert.Equal("disabled", json.GetProperty("status").GetString());
        Assert.Equal(14, json.GetProperty("nightsRequested").GetInt32());
        Assert.Equal(0, json.GetProperty("nights").GetArrayLength());
        Assert.Equal(0, json.GetProperty("weekdayWeekend").GetProperty("weekday").GetProperty("countedNights").GetInt32());
        Assert.Equal(0, json.GetProperty("typicalNight").GetProperty("hours").GetArrayLength());
    }

    [Fact]
    public async Task EachMember_GetsOnlyTheirOwnHistory()
    {
        var cast = await SeedWeekAsync();
        await TurnOnAsync(As(cast.Mother));
        await TurnOnAsync(As(cast.Father));

        var mother = await HistoryAsync(cast.Mother);
        var father = await HistoryAsync(cast.Father);
        var viewer = await HistoryAsync(cast.Viewer);

        var motherFriday = Night(mother, "2026-01-09").GetProperty("parts").EnumerateArray().ToArray();
        Assert.Equal(["21:20", "03:00", "05:20"], motherFriday.Select(part => Time(part, "start")));
        Assert.Equal("01:50", Time(motherFriday[0], "end"));
        var fatherFriday = Assert.Single(Night(father, "2026-01-09").GetProperty("parts").EnumerateArray());
        Assert.Equal("21:20", Time(fatherFriday, "start"));
        Assert.Equal("babyFinalWake", fatherFriday.GetProperty("endSource").GetString());
        Assert.DoesNotContain("ownEvent", father.GetRawText(), StringComparison.Ordinal);
        Assert.Equal("disabled", viewer.GetProperty("status").GetString());
        Assert.Equal(0, viewer.GetProperty("nights").GetArrayLength());
    }

    [Fact]
    public async Task WorkWindowOverlappingTheNight_IsFlaggedAndNotCounted()
    {
        var cast = await SeedWeekAsync();
        await TurnOnAsync(As(cast.Father), [new { days = new[] { 3 }, start = "22:00", end = "06:00" }]);

        var json = await HistoryAsync(cast.Father);

        var wednesday = Night(json, "2026-01-07");
        Assert.True(wednesday.GetProperty("workOverlap").GetBoolean());
        Assert.False(wednesday.GetProperty("counted").GetBoolean());
        Assert.False(Night(json, "2026-01-08").GetProperty("workOverlap").GetBoolean());
        Assert.Equal(4, json.GetProperty("weekdayWeekend").GetProperty("weekday").GetProperty("countedNights").GetInt32());
    }

    [Fact]
    public async Task NothingOfTheHistory_IsWrittenToTheLogs()
    {
        var cast = await SeedWeekAsync();
        var logs = new CapturingLoggerProvider();
        using var host = factory.WithFixedClock().WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddSingleton<ILoggerProvider>(logs)));
        var client = host.ClientFor(cast.Mother.Subject);
        await TurnOnAsync(client);

        var response = await client.GetAsync(Path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var lines = logs.Messages;
        Assert.Contains(lines, line => line.StartsWith("Computed the rest history of user ", StringComparison.Ordinal));
        string[] forbidden = ["21:20", "01:50", "04:15", "05:20", "restedMinutes", "typicalNight", "workOverlap", "babyFinalWake", "ownEvent"];
        Assert.DoesNotContain(lines, line => forbidden.Any(text => line.Contains(text, StringComparison.Ordinal)));
    }

    [Fact]
    public async Task TheBabyBackup_HoldsNothingOfTheHistory()
    {
        var cast = await SeedWeekAsync();
        var mother = As(cast.Mother);
        await TurnOnAsync(mother, [new { days = new[] { 3 }, start = "22:00", end = "06:00" }]);
        Assert.Equal(HttpStatusCode.OK, (await mother.GetAsync(Path)).StatusCode);

        var backup = await (await mother.GetAsync($"/api/v1/babies/{cast.BabyId}/export?compress=false")).Content.ReadAsStringAsync();

        Assert.Contains("lotties-backup", backup, StringComparison.Ordinal);
        string[] forbidden = ["restedMinutes", "typicalNight", "weekdayWeekend", "workOverlap", "workWindows", "nightsRequested", "fallAsleepMinutes"];
        Assert.DoesNotContain(forbidden, text => backup.Contains(text, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Unauthenticated_Is401() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync(Path)).StatusCode);

    private static T Throwing<T>() where T : class => DispatchProxy.Create<T, RestEstimateEndpointTests.ThrowingProxy>();
}
