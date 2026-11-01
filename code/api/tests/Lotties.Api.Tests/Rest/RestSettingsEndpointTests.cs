using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Backups;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Rest;

/// <summary><c>GET/PUT/DELETE /me/rest-settings</c> and <c>PUT /me/rest/morning</c> (docs/design/41-caregiver-rest.md).</summary>
public sealed class RestSettingsEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = "/api/v1/me/rest-settings";
    private const string MorningPath = "/api/v1/me/rest/morning";

    private static object Body(
        bool enabled = true,
        string timeZone = "America/Sao_Paulo",
        object[]? workWindows = null,
        string nightStart = "20:00",
        string nightEnd = "06:30",
        int fallAsleep = 15,
        int wakeLead = 25) => new
        {
            enabled,
            timeZone,
            workWindows = workWindows ?? [new { days = new[] { 1, 2, 3, 4, 5 }, start = "08:00", end = "17:00" }],
            nightStart,
            nightEnd,
            fallAsleepMinutes = fallAsleep,
            wakeLeadMinutes = wakeLead,
        };

    public static TheoryData<string, object> Invalid() => new()
    {
        { "timeZone", Body(timeZone: "Mars/Olympus") },
        { "workWindows", Body(workWindows: [.. Enumerable.Range(0, 15).Select(_ => new { days = new[] { 1 }, start = "08:00", end = "09:00" })]) },
        { "workWindows", Body(workWindows: [new { days = new[] { 1 }, start = "08:00", end = "08:00" }]) },
        { "workWindows", Body(workWindows: [new { days = Array.Empty<int>(), start = "08:00", end = "09:00" }]) },
        { "workWindows", Body(workWindows: [new { days = new[] { 1, 1 }, start = "08:00", end = "09:00" }]) },
        { "workWindows", Body(workWindows: [new { days = new[] { 8 }, start = "08:00", end = "09:00" }]) },
        { "workWindows", Body(workWindows: [new { days = new[] { 1 }, start = "8am", end = "09:00" }]) },
        { "fallAsleepMinutes", Body(fallAsleep: 4) },
        { "fallAsleepMinutes", Body(fallAsleep: 61) },
        { "wakeLeadMinutes", Body(wakeLead: 4) },
        { "wakeLeadMinutes", Body(wakeLead: 61) },
        { "nightEnd", Body(nightStart: "19:00", nightEnd: "19:00") },
        { "nightStart", Body(nightStart: "25:00") },
        { "enabled", new { timeZone = "UTC" } },
    };

    [Fact]
    public async Task Get_BeforeAnyPut_ReturnsTheDefaults()
    {
        var json = await (await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.False(json.GetProperty("enabled").GetBoolean());
        Assert.Equal("UTC", json.GetProperty("timeZone").GetString());
        Assert.Equal(0, json.GetProperty("workWindows").GetArrayLength());
        Assert.Equal("19:00", json.GetProperty("nightStart").GetString());
        Assert.Equal("07:00", json.GetProperty("nightEnd").GetString());
        Assert.Equal(20, json.GetProperty("fallAsleepMinutes").GetInt32());
        Assert.Equal(20, json.GetProperty("wakeLeadMinutes").GetInt32());
    }

    [Fact]
    public async Task Put_RoundTrips_AndIsIdempotent()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());
        var body = Body(workWindows: [new { days = new[] { 5, 1, 2 }, start = "22:00", end = "06:00" }]);

        var first = await (await client.PutAsJsonAsync(Path, body)).ReadAsync<JsonElement>();
        var second = await (await client.PutAsJsonAsync(Path, body)).ReadAsync<JsonElement>();
        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.Equal(first.ToString(), second.ToString());
        Assert.Equal(first.ToString(), read.ToString());
        Assert.True(read.GetProperty("enabled").GetBoolean());
        Assert.Equal("America/Sao_Paulo", read.GetProperty("timeZone").GetString());
        Assert.Equal(15, read.GetProperty("fallAsleepMinutes").GetInt32());
        Assert.Equal(25, read.GetProperty("wakeLeadMinutes").GetInt32());
        var window = read.GetProperty("workWindows")[0];
        Assert.Equal([1, 2, 5], window.GetProperty("days").EnumerateArray().Select(day => day.GetInt32()));
        Assert.Equal("22:00", window.GetProperty("start").GetString());
        Assert.Equal("06:00", window.GetProperty("end").GetString());
    }

    [Fact]
    public async Task Put_SecondDifferentPut_Wins()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());
        (await client.PutAsJsonAsync(Path, Body())).EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync(Path, Body(enabled: false, workWindows: []))).EnsureSuccessStatusCode();

        var read = await (await client.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.False(read.GetProperty("enabled").GetBoolean());
        Assert.Equal(0, read.GetProperty("workWindows").GetArrayLength());
    }

    [Theory]
    [MemberData(nameof(Invalid))]
    public async Task Put_Invalid_Is400WithTheField(string field, object body)
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());

        var problem = await (await client.PutAsJsonAsync(Path, body)).AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");

        Assert.Equal(field, problem.GetProperty("field").GetString());
        Assert.Equal("UTC", (await (await client.GetAsync(Path)).ReadAsync<JsonElement>()).GetProperty("timeZone").GetString());
    }

    [Fact]
    public async Task Put_FourteenWindows_IsAccepted()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());

        var response = await client.PutAsJsonAsync(Path, Body(workWindows: [.. Enumerable.Range(0, 14).Select(_ => new { days = new[] { 1 }, start = "08:00", end = "09:00" })]));

        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Settings_BelongToTheCallerOnly()
    {
        var mine = factory.CreateClientFor(TestUsers.NewSubject());
        var other = factory.CreateClientFor(TestUsers.NewSubject());
        (await mine.PutAsJsonAsync(Path, Body())).EnsureSuccessStatusCode();

        var read = await (await other.GetAsync(Path)).ReadAsync<JsonElement>();

        Assert.False(read.GetProperty("enabled").GetBoolean());
        Assert.Equal(0, read.GetProperty("workWindows").GetArrayLength());
    }

    [Fact]
    public async Task Unauthenticated_Is401()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync(Path)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PutAsJsonAsync(Path, Body())).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().DeleteAsync(Path)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PutAsJsonAsync(MorningPath, new { })).StatusCode);
    }

    [Fact]
    public async Task Morning_SavesAndReplacesTheAnswerOfANight()
    {
        var subject = TestUsers.NewSubject();
        var client = factory.CreateClientFor(subject);
        var night = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1));
        var first = DateTimeOffset.UtcNow.AddHours(-3);
        var second = DateTimeOffset.UtcNow.AddHours(-2);

        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync(MorningPath, new { night = night.ToString("yyyy-MM-dd"), upAt = first })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync(MorningPath, new { night = night.ToString("yyyy-MM-dd"), upAt = second })).StatusCode);

        var userId = await factory.UserIdAsync(subject);
        var rows = await factory.QueryAsync(context => context.UserRestMornings.Where(row => row.UserId == userId).ToListAsync());
        var row = Assert.Single(rows);
        Assert.Equal(night, row.Night);
        Assert.Equal(second.ToUnixTimeSeconds(), row.UpAt.ToUnixTimeSeconds());
    }

    [Fact]
    public async Task Morning_Invalid_Is400()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());
        var night = DateTime.UtcNow.AddDays(-1).ToString("yyyy-MM-dd");

        var future = await (await client.PutAsJsonAsync(MorningPath, new { night, upAt = DateTimeOffset.UtcNow.AddMinutes(10) })).AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        var tooEarly = await (await client.PutAsJsonAsync(MorningPath, new { night, upAt = DateTimeOffset.UtcNow.AddDays(-3) })).AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        var badNight = await (await client.PutAsJsonAsync(MorningPath, new { night = "yesterday", upAt = DateTimeOffset.UtcNow.AddHours(-1) })).AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        var noUpAt = await (await client.PutAsJsonAsync(MorningPath, new { night })).AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");

        Assert.Equal("upAt", future.GetProperty("field").GetString());
        Assert.Equal("upAt", tooEarly.GetProperty("field").GetString());
        Assert.Equal("night", badNight.GetProperty("field").GetString());
        Assert.Equal("upAt", noUpAt.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Delete_RemovesTheSettingsAndEveryMorningAnswer_OfTheCallerOnly()
    {
        var subject = TestUsers.NewSubject();
        var client = factory.CreateClientFor(subject);
        var other = TestUsers.NewSubject();
        var otherClient = factory.CreateClientFor(other);
        var night = DateTime.UtcNow.AddDays(-1).ToString("yyyy-MM-dd");
        foreach (var each in new[] { client, otherClient })
        {
            (await each.PutAsJsonAsync(Path, Body())).EnsureSuccessStatusCode();
            (await each.PutAsJsonAsync(MorningPath, new { night, upAt = DateTimeOffset.UtcNow.AddHours(-1) })).EnsureSuccessStatusCode();
        }

        var userId = await factory.UserIdAsync(subject);
        var otherId = await factory.UserIdAsync(other);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync(Path)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync(Path)).StatusCode);

        Assert.False(await factory.QueryAsync(context => context.UserRestSettings.AnyAsync(row => row.UserId == userId)));
        Assert.False(await factory.QueryAsync(context => context.UserRestMornings.AnyAsync(row => row.UserId == userId)));
        Assert.True(await factory.QueryAsync(context => context.UserRestSettings.AnyAsync(row => row.UserId == otherId)));
        Assert.True(await factory.QueryAsync(context => context.UserRestMornings.AnyAsync(row => row.UserId == otherId)));
        Assert.False((await (await client.GetAsync(Path)).ReadAsync<JsonElement>()).GetProperty("enabled").GetBoolean());
    }

    [Fact]
    public async Task DeleteAccount_RemovesTheSettingsAndTheMorningAnswers()
    {
        var subject = TestUsers.NewSubject();
        var client = factory.CreateClientFor(subject);
        (await client.PutAsJsonAsync(Path, Body())).EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync(MorningPath, new { night = DateTime.UtcNow.AddDays(-1).ToString("yyyy-MM-dd"), upAt = DateTimeOffset.UtcNow.AddHours(-1) })).EnsureSuccessStatusCode();
        var userId = await factory.UserIdAsync(subject);

        (await client.DeleteAsync("/api/v1/me")).EnsureSuccessStatusCode();

        Assert.False(await factory.QueryAsync(context => context.UserRestSettings.AnyAsync(row => row.UserId == userId)));
        Assert.False(await factory.QueryAsync(context => context.UserRestMornings.AnyAsync(row => row.UserId == userId)));
    }

    [Fact]
    public void BackupFile_HoldsNothingOfRest()
    {
        var names = typeof(BackupFile).GetProperties().Select(property => property.Name);

        Assert.DoesNotContain(names, name => name.Contains("Rest", StringComparison.OrdinalIgnoreCase) || name.Contains("WorkWindow", StringComparison.OrdinalIgnoreCase));
    }
}
