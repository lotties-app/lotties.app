using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.EventTypes;
using static Lotties.Api.Tests.Assistants.AssistantTestKit;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// "Log 15 minutes of tummy time": the activities with a duration take an optional number of minutes. With it ONE finished entry is
/// stored (started minutes ago, ended now); without it the timer starts as before; outside 1-720 nothing is stored.
/// </summary>
public sealed class AssistantActivityMinutesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly (string Name, Guid TypeId, AssistantResultCode Started, AssistantResultCode Logged, Func<IAssistantService, AssistantInvocation, int?, Task<AssistantResult>> Run)[] Activities =
    [
        ("tummy_time", BuiltInEventTypes.TummyTimeId, AssistantResultCode.TummyTimeStarted, AssistantResultCode.TummyTimeLogged, (a, i, m) => a.LogTummyTimeAsync(i, m)),
        ("breast_pump", BuiltInEventTypes.BreastPumpId, AssistantResultCode.BreastPumpStarted, AssistantResultCode.BreastPumpLogged, (a, i, m) => a.LogBreastPumpAsync(i, 50, null, m)),
        ("belly_massage", BuiltInEventTypes.BellyMassageId, AssistantResultCode.BellyMassageStarted, AssistantResultCode.BellyMassageLogged, (a, i, m) => a.LogBellyMassageAsync(i, "gas", null, m)),
        ("fussy", BuiltInEventTypes.FussyId, AssistantResultCode.FussyStarted, AssistantResultCode.FussyLogged, (a, i, m) => a.LogFussyAsync(i, "mild", null, m)),
        ("outdoor", BuiltInEventTypes.OutdoorId, AssistantResultCode.OutdoorStarted, AssistantResultCode.OutdoorLogged, (a, i, m) => a.LogOutdoorAsync(i, "park", m)),
    ];

    public static IEnumerable<object[]> Names() => Activities.Select(activity => new object[] { activity.Name });

    private static (string Name, Guid TypeId, AssistantResultCode Started, AssistantResultCode Logged, Func<IAssistantService, AssistantInvocation, int?, Task<AssistantResult>> Run) Activity(string name) =>
        Activities.Single(activity => activity.Name == name);

    [Theory]
    [MemberData(nameof(Names))]
    public async Task WithMinutes_StoresOneFinishedEntryEndingNow_WithTheOriginMarker(string name)
    {
        var baby = await factory.SeedBabyAsync();
        var activity = Activity(name);

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => activity.Run(assistant, Invocation(adapter: "siri"), 15));

        var stored = Assert.Single(await factory.EventsAsync(baby.BabyId));
        Assert.Equal((activity.Logged, 15), (result.Code, result.Minutes));
        Assert.Equal(activity.TypeId, stored.TypeId);
        Assert.Equal(TimeSpan.FromMinutes(15), stored.EndedAt - stored.StartedAt);
        Assert.Equal(stored.StartedAt, result.At);
        Assert.True(DateTimeOffset.UtcNow - stored.EndedAt < TimeSpan.FromMinutes(2));
        Assert.Equal("siri", PayloadOf(stored).GetProperty("via").GetString());
    }

    [Theory]
    [MemberData(nameof(Names))]
    public async Task WithoutMinutes_StillStartsARunningTimer(string name)
    {
        var baby = await factory.SeedBabyAsync();
        var activity = Activity(name);

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => activity.Run(assistant, Invocation(), null));

        Assert.Equal(activity.Started, result.Code);
        Assert.Null(result.Minutes);
        Assert.Null(Assert.Single(await factory.EventsAsync(baby.BabyId)).EndedAt);
    }

    [Theory]
    [MemberData(nameof(Names))]
    public async Task MinutesOutsideOneToSevenHundredTwenty_AreRefused_AndNothingIsStored(string name)
    {
        var baby = await factory.SeedBabyAsync();
        var activity = Activity(name);

        var results = new List<AssistantResult>();
        foreach (var minutes in new[] { 0, -5, 721 })
        {
            results.Add(await factory.RunAsAsync(baby.OwnerSubject, assistant => activity.Run(assistant, Invocation(), minutes)));
        }

        Assert.All(results, result => Assert.Equal((AssistantResultCode.InvalidValue, "minutes", 1, 720), (result.Code, result.Field, result.Min, result.Max)));
        Assert.Empty(await factory.EventsAsync(baby.BabyId));
    }

    [Theory]
    [MemberData(nameof(Names))]
    public async Task ReplayOfTheSameRequest_WritesNothingMore(string name)
    {
        var baby = await factory.SeedBabyAsync();
        var activity = Activity(name);
        var invocation = Invocation("same-request");

        var first = await factory.RunAsAsync(baby.OwnerSubject, assistant => activity.Run(assistant, invocation, 20));
        var replay = await factory.RunAsAsync(baby.OwnerSubject, assistant => activity.Run(assistant, invocation, 20));

        Assert.Single(await factory.EventsAsync(baby.BabyId));
        Assert.Equal((first.Code, first.At, first.Minutes), (replay.Code, replay.At, replay.Minutes));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(720)]
    public async Task TheLimits_AreAccepted(int minutes)
    {
        var baby = await factory.SeedBabyAsync();

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogTummyTimeAsync(Invocation(), minutes));

        var stored = Assert.Single(await factory.EventsAsync(baby.BabyId));
        Assert.Equal(AssistantResultCode.TummyTimeLogged, result.Code);
        Assert.Equal(TimeSpan.FromMinutes(minutes), stored.EndedAt - stored.StartedAt);
    }
}
