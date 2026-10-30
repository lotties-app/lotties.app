using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.Clinical;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Users;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Rest;

/// <summary><c>GET /me/rest</c> (docs/design/41-caregiver-rest.md sections 2 and 11). The clock is fixed at 2026-01-10 12:00 UTC; the night is 2026-01-09, zone UTC.</summary>
public sealed class RestEstimateEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = "/api/v1/me/rest";
    private const string SettingsPath = "/api/v1/me/rest-settings";
    private const string Night = "2026-01-09";

    private sealed record Cast(Guid BabyId, User Mother, User Father, User Doctor, User Viewer);

    private static DateTimeOffset At(int day, int hour, int minute = 0) => new(2026, 1, day, hour, minute, 0, TimeSpan.Zero);

    private static User NewUser(string name) => User.Create(User.UnknownIssuer, TestUsers.NewSubject(), name, TestUsers.Now);

    private static Event Logged(Guid babyId, Guid by, Guid typeId, DateTimeOffset start, DateTimeOffset? end) =>
        Event.Create(Guid.NewGuid(), babyId, typeId, by, start, end, EventPayload.Empty, null, start);

    private Task SeedUserAsync(User user) => factory.SeedAsync(context =>
    {
        context.Users.Add(user);
        return Task.CompletedTask;
    });

    /// <summary>The worked example: baby sleeps 21:00-02:05, 02:40-04:30, 05:00-06:30; the mother logs feeds at 02:10 and 04:35; nobody else logs.</summary>
    private async Task<Cast> SeedWorkedExampleAsync()
    {
        var cast = new Cast(Guid.Empty, NewUser("Mother"), NewUser("Father"), NewUser("Doctor"), NewUser("Viewer"));
        var baby = Baby.Create("Lia", new DateOnly(2025, 6, 1), cast.Mother.Id, TestUsers.Now);
        baby.AddMember(cast.Father.Id, BabyRole.Parent, TestUsers.Now);
        baby.AddMember(cast.Doctor.Id, BabyRole.Doctor, TestUsers.Now);
        baby.AddMember(cast.Viewer.Id, BabyRole.Viewer, TestUsers.Now);
        var sleep = BuiltInEventTypes.SleepId;
        var feeding = BuiltInEventTypes.FeedingId;
        await factory.SeedAsync(context =>
        {
            context.Users.AddRange(cast.Mother, cast.Father, cast.Doctor, cast.Viewer);
            context.Babies.Add(baby);
            context.Events.AddRange(
                Logged(baby.Id, cast.Mother.Id, sleep, At(9, 21), At(10, 2, 5)),
                Logged(baby.Id, cast.Mother.Id, feeding, At(10, 2, 10), At(10, 2, 25)),
                Logged(baby.Id, cast.Mother.Id, sleep, At(10, 2, 40), At(10, 4, 30)),
                Logged(baby.Id, cast.Mother.Id, feeding, At(10, 4, 35), At(10, 4, 50)),
                Logged(baby.Id, cast.Mother.Id, sleep, At(10, 5), At(10, 6, 30)));
            return Task.CompletedTask;
        });
        return cast with { BabyId = baby.Id };
    }

    private HttpClient As(User user) => factory.WithFixedClock().ClientFor(user.Subject);

    private static Task<HttpResponseMessage> TurnOnAsync(HttpClient client) =>
        client.PutAsJsonAsync(SettingsPath, new
        {
            enabled = true,
            timeZone = "UTC",
            workWindows = Array.Empty<object>(),
            nightStart = "19:00",
            nightEnd = "07:00",
            fallAsleepMinutes = 20,
            wakeLeadMinutes = 20,
        });

    private async Task<JsonElement> EstimateAsync(User user, string query = "?night=" + Night) =>
        await (await As(user).GetAsync(Path + query)).ReadAsync<JsonElement>();

    private static string Time(JsonElement part, string name) => part.GetProperty(name).GetDateTimeOffset().ToString("HH:mm");

    [Fact]
    public async Task Disabled_ReturnsDisabled_WithoutReadingAnyBabyOrEvent()
    {
        var user = NewUser("Off");
        await SeedUserAsync(user);
        using var host = factory.WithFixedClock().WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddScoped(_ => Throwing<IClinicalEventRepository>());
            services.AddScoped(_ => Throwing<IBabyRepository>());
        }));
        var client = host.ClientFor(user.Subject);

        var response = await client.GetAsync(Path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await response.ReadAsync<JsonElement>();
        Assert.Equal("disabled", json.GetProperty("status").GetString());
        Assert.Equal(0, json.GetProperty("parts").GetArrayLength());
        Assert.False(json.GetProperty("askMorning").GetBoolean());
        Assert.Equal(20, json.GetProperty("constants").GetProperty("fallAsleepMinutes").GetInt32());
    }

    [Fact]
    public async Task WorkedExample_MotherAndFather_GetTheirOwnParts()
    {
        var cast = await SeedWorkedExampleAsync();
        Assert.True((await TurnOnAsync(As(cast.Mother))).IsSuccessStatusCode);
        Assert.True((await TurnOnAsync(As(cast.Father))).IsSuccessStatusCode);

        var mother = await EstimateAsync(cast.Mother);
        var father = await EstimateAsync(cast.Father);

        Assert.Equal(Night, mother.GetProperty("night").GetString());
        Assert.Equal("ok", mother.GetProperty("status").GetString());
        var parts = mother.GetProperty("parts").EnumerateArray().ToArray();
        Assert.Equal(["21:20", "03:00", "05:20"], parts.Select(part => Time(part, "start")));
        Assert.Equal("01:50", Time(parts[0], "end"));
        Assert.Equal("04:15", Time(parts[1], "end"));
        Assert.Equal("babyLog", parts[0].GetProperty("startSource").GetString());
        Assert.Equal("ownEvent", parts[0].GetProperty("endSource").GetString());
        Assert.Equal("normal", parts[0].GetProperty("confidence").GetString());
        Assert.Equal(20, mother.GetProperty("constants").GetProperty("wakeLeadMinutes").GetInt32());

        var single = Assert.Single(father.GetProperty("parts").EnumerateArray());
        Assert.Equal("21:20", Time(single, "start"));
        Assert.Equal("babyFinalWake", single.GetProperty("endSource").GetString());
        Assert.Equal("low", single.GetProperty("confidence").GetString());
        Assert.True(father.GetProperty("askMorning").GetBoolean());
        Assert.False(mother.GetProperty("askMorning").GetBoolean());
    }

    [Fact]
    public async Task MorningAnswer_EndsTheRestAsConfirmed_AndStopsAskingMorning()
    {
        var cast = await SeedWorkedExampleAsync();
        var father = As(cast.Father);
        await TurnOnAsync(father);
        var before = await EstimateAsync(cast.Father);

        var put = await father.PutAsJsonAsync(Path + "/morning", new { night = Night, upAt = At(10, 6, 40) });
        var after = await EstimateAsync(cast.Father);

        Assert.True(before.GetProperty("askMorning").GetBoolean());
        Assert.Equal(HttpStatusCode.NoContent, put.StatusCode);
        var part = Assert.Single(after.GetProperty("parts").EnumerateArray());
        Assert.Equal("confirmed", part.GetProperty("endSource").GetString());
        Assert.False(after.GetProperty("askMorning").GetBoolean());
    }

    [Fact]
    public async Task NoBabySleepInTheNight_IsNotEnoughLog()
    {
        var user = NewUser("Alone");
        var baby = Baby.Create("Lia", new DateOnly(2025, 6, 1), user.Id, TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Users.Add(user);
            context.Babies.Add(baby);
            context.Events.Add(Logged(baby.Id, user.Id, BuiltInEventTypes.SleepId, At(9, 13), At(9, 14)));
            return Task.CompletedTask;
        });
        await TurnOnAsync(As(user));

        var json = await EstimateAsync(user);

        Assert.Equal("notEnoughLog", json.GetProperty("status").GetString());
        Assert.Equal(0, json.GetProperty("parts").GetArrayLength());
    }

    [Fact]
    public async Task DoctorOnly_GetsNoBabyData()
    {
        var cast = await SeedWorkedExampleAsync();
        await TurnOnAsync(As(cast.Doctor));

        var json = await EstimateAsync(cast.Doctor);

        Assert.Equal("notEnoughLog", json.GetProperty("status").GetString());
        Assert.Equal(0, json.GetProperty("parts").GetArrayLength());
    }

    [Fact]
    public async Task Viewer_GetsTheEstimate_FromTheBabyLogOnly()
    {
        var cast = await SeedWorkedExampleAsync();
        await TurnOnAsync(As(cast.Viewer));

        var json = await EstimateAsync(cast.Viewer);

        var part = Assert.Single(json.GetProperty("parts").EnumerateArray());
        Assert.Equal("21:20", Time(part, "start"));
        Assert.Equal("babyFinalWake", part.GetProperty("endSource").GetString());
        Assert.Equal("low", part.GetProperty("confidence").GetString());
    }

    [Fact]
    public async Task TheRouteAnswersOnlyForTheCaller_NotForAnotherMemberWhoTurnedItOn()
    {
        var cast = await SeedWorkedExampleAsync();
        await TurnOnAsync(As(cast.Mother));

        var father = await EstimateAsync(cast.Father);
        var owner = await EstimateAsync(cast.Mother);

        Assert.Equal("disabled", father.GetProperty("status").GetString());
        Assert.Equal(0, father.GetProperty("parts").GetArrayLength());
        Assert.Equal("ok", owner.GetProperty("status").GetString());
    }

    [Fact]
    public async Task WithoutNight_UsesTheLatestNightStarted()
    {
        var cast = await SeedWorkedExampleAsync();
        await TurnOnAsync(As(cast.Mother));

        var json = await EstimateAsync(cast.Mother, string.Empty);

        Assert.Equal(Night, json.GetProperty("night").GetString());
        Assert.Equal("ok", json.GetProperty("status").GetString());
    }

    [Theory]
    [InlineData("?night=yesterday")]
    [InlineData("?night=2026-13-40")]
    [InlineData("?night=2026-1-9")]
    public async Task BadNight_Is400WithTheField(string query)
    {
        var user = NewUser("Bad");
        await SeedUserAsync(user);

        var problem = await (await As(user).GetAsync(Path + query)).AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");

        Assert.Equal("night", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Unauthenticated_Is401() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync(Path)).StatusCode);

    private static T Throwing<T>() where T : class => DispatchProxy.Create<T, ThrowingProxy>();

    public class ThrowingProxy : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) =>
            throw new InvalidOperationException($"{targetMethod?.DeclaringType?.Name}.{targetMethod?.Name} must not be called while the feature is off.");
    }
}
