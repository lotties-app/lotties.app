using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.CryReasons;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Microsoft.AspNetCore.Mvc.Testing;
using static Lotties.Api.Tests.Assistants.AssistantTestKit;
using static Lotties.Api.Tests.Support.ClinicalTestData;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The read-only questions added to the voice assistants (docs/design/32-assistants.md): the next nap window, feed and diaper
/// change from the Domain predictions, the diapers per day, the facts of the last bottles, sleep today, the last diaper and
/// "why is she crying". The clock is fixed at 2026-01-10 12:00 UTC = 09:00 in São Paulo; the baby is a few months old.
/// </summary>
public sealed class AssistantForecastsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Zone = "America/Sao_Paulo";

    private readonly WebApplicationFactory<Program> _host = factory.WithFixedClock();

    private async Task<SeededPatient> BabyAsync(Func<Guid, Guid, IEnumerable<Event>> log)
    {
        var (_, memberId) = await factory.SeedUserAsync();
        var baby = await factory.SeedPatientAsync(memberId, "Lia", role: BabyRole.Viewer, birthDate: new DateOnly(2025, 9, 1));
        var events = log(baby.BabyId, baby.OwnerId).ToArray();
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(events);
            return Task.CompletedTask;
        });
        await factory.SetTimeZoneAsync(baby.OwnerSubject, Zone);
        return baby;
    }

    private static Event Log(Guid babyId, Guid userId, Guid typeId, DateTimeOffset start, DateTimeOffset? end, string payload = "{}") =>
        NewEvent(babyId, userId, typeId, start, end, payload);

    private static IEnumerable<Event> Feeds(Guid babyId, Guid userId, IEnumerable<DateTimeOffset> starts, int ml = 120) =>
        starts.Select(start => Log(babyId, userId, BuiltInEventTypes.FeedingId, start, start.AddMinutes(15), $$"""{"method":"bottle","amount_ml":{{ml}},"bottle_feeding_type":"formula"}"""));

    /// <summary>A feed every three hours from 01:00 on January 7 to 09 and up to <paramref name="lastHour"/> on January 10 (São Paulo).</summary>
    private static IEnumerable<DateTimeOffset> ThreeHourlyFeeds(int lastHour) =>
        Enumerable.Range(7, 3).SelectMany(day => Enumerable.Range(0, 8).Select(slot => Local(day, 1 + (slot * 3))))
            .Concat(Enumerable.Range(0, ((lastHour - 1) / 3) + 1).Select(slot => Local(10, 1 + (slot * 3))));

    [Fact]
    public async Task NextFeed_ThreeHourlyFeeds_ExpectsTheNextOneThreeHoursAfterTheLast()
    {
        var baby = await BabyAsync((id, user) => Feeds(id, user, ThreeHourlyFeeds(7)));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextFeedAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NextFeed, result.Code);
        Assert.Equal(Zone, result.TimeZone);
        Assert.Equal(Local(10, 10), result.Estimate!.Expected, TimeSpan.FromMinutes(5));
        Assert.True(result.Estimate.Earliest <= result.Estimate.Expected && result.Estimate.Expected <= result.Estimate.Latest);
    }

    [Fact]
    public async Task NextFeed_TooFewFeeds_SaysThereIsNoEstimate()
    {
        var baby = await BabyAsync((id, user) => Feeds(id, user, [Local(10, 1), Local(10, 4)]));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextFeedAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NoNextFeed, result.Code);
        Assert.Null(result.Estimate);
    }

    [Fact]
    public async Task NextDiaper_RegularWetAndDirtyDiapers_ExpectsBoth()
    {
        var baby = await BabyAsync((id, user) =>
            Enumerable.Range(7, 3).SelectMany(day => Enumerable.Range(0, 8).Select(slot => Local(day, slot * 3)))
                .Concat(Enumerable.Range(0, 3).Select(slot => Local(10, slot * 3)))
                .Select(at => Log(id, user, BuiltInEventTypes.DiaperId, at, at, """{"content":"WET"}"""))
                .Concat(Enumerable.Range(3, 7).SelectMany(day => new[] { Local(day, 10), Local(day, 22) })
                    .Select(at => Log(id, user, BuiltInEventTypes.DiaperId, at, at, """{"content":"DIRTY"}"""))));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextDiaperAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NextDiaper, result.Code);
        Assert.Equal(Local(10, 9), result.WetEstimate!.Expected, TimeSpan.FromMinutes(5));
        Assert.NotNull(result.DirtyEstimate);
    }

    [Fact]
    public async Task NextDiaper_NoDiapers_SaysThereIsNoEstimate()
    {
        var baby = await BabyAsync((_, _) => []);

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextDiaperAsync(Invocation()));

        Assert.Equal((AssistantResultCode.NoNextDiaper, null, null), (result.Code, result.WetEstimate, result.DirtyEstimate));
    }

    /// <summary>Four days of the same rhythm: up at 07:00, a nap at 09:30 for an hour, another at 13:30 for 90 minutes, bed at 20:00.</summary>
    private static IEnumerable<Event> Naps(Guid babyId, Guid userId, int lastDay)
    {
        foreach (var day in Enumerable.Range(lastDay - 4, 4))
        {
            yield return Log(babyId, userId, BuiltInEventTypes.SleepId, Local(day, 9, 30), Local(day, 10, 30), """{"kind":"nap"}""");
            yield return Log(babyId, userId, BuiltInEventTypes.SleepId, Local(day, 13, 30), Local(day, 15), """{"kind":"nap"}""");
            yield return Log(babyId, userId, BuiltInEventTypes.SleepId, Local(day, 20), Local(day + 1, 7), """{"kind":"night"}""");
        }
    }

    [Fact]
    public async Task NextNapWindow_AwakeWithARhythm_GivesTheWindow()
    {
        var baby = await BabyAsync((id, user) => Naps(id, user, 10));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextNapWindowAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NextNapWindow, result.Code);
        Assert.InRange(result.Estimate!.Expected, Local(10, 9), Local(10, 11));
        Assert.True(result.Estimate.Earliest <= result.Estimate.Expected && result.Estimate.Expected <= result.Estimate.Latest);
    }

    [Fact]
    public async Task NextNapWindow_ASleepRuns_SaysSheSleepsWithoutAWindow()
    {
        var baby = await BabyAsync((id, user) => Naps(id, user, 10).Append(Log(id, user, BuiltInEventTypes.SleepId, Local(10, 8, 30), null, """{"kind":"nap"}""")));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextNapWindowAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NapWindowAsleep, result.Code);
        Assert.Equal(Local(10, 8, 30), result.At);
        Assert.Null(result.Estimate);
        if (result.EndedAt is { } wakes)
        {
            Assert.True(wakes > result.AsOf);
        }
    }

    [Fact]
    public async Task NextNapWindow_NoSleepHistory_SaysThereIsNoEstimate()
    {
        var baby = await BabyAsync((id, user) => [Log(id, user, BuiltInEventTypes.SleepId, Local(10, 1), Local(10, 7), """{"kind":"night"}""")]);

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextNapWindowAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NoNapPrediction, result.Code);
    }

    [Fact]
    public async Task NextNapWindow_LastSleepOverADayAgo_IsStale()
    {
        var baby = await BabyAsync((id, user) => Naps(id, user, 8));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextNapWindowAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NoNapPrediction, result.Code);
    }

    private static IEnumerable<Event> DiapersOnDays(Guid babyId, Guid userId, params (int Day, int Wet, int Dirty, int Mixed)[] days) =>
        days.SelectMany(entry =>
            Enumerable.Range(0, entry.Wet).Select(index => (At: Local(entry.Day, 6 + index), Content: "WET"))
                .Concat(Enumerable.Range(0, entry.Dirty).Select(index => (At: Local(entry.Day, 12 + index), Content: "DIRTY")))
                .Concat(Enumerable.Range(0, entry.Mixed).Select(index => (At: Local(entry.Day, 18 + index), Content: "MIXED"))))
            .Select(entry => Log(babyId, userId, BuiltInEventTypes.DiaperId, entry.At, entry.At, $$"""{"content":"{{entry.Content}}"}"""));

    [Fact]
    public async Task DiapersAverage_FourCompleteDays_AveragesWithoutToday()
    {
        var baby = await BabyAsync((id, user) => DiapersOnDays(id, user, (4, 4, 2, 0), (5, 5, 2, 0), (7, 3, 1, 1), (8, 6, 3, 0), (10, 3, 2, 1)));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDiapersAverageAsync(Invocation()));

        Assert.Equal(AssistantResultCode.DiapersAverage, result.Code);
        Assert.Equal((4, 6.8, 4.8, 2.3), (result.Count, result.PerDay, result.WetPerDay, result.DirtyPerDay));
        Assert.Equal(Zone, result.TimeZone);
    }

    [Fact]
    public async Task DiapersAverage_OnlyTwoDaysWithDiapers_IsNotEnough()
    {
        var baby = await BabyAsync((id, user) => DiapersOnDays(id, user, (8, 5, 2, 0), (9, 6, 1, 0), (2, 5, 5, 0)));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDiapersAverageAsync(Invocation()));

        Assert.Equal((AssistantResultCode.NoDiapersAverage, 2, null), (result.Code, result.Count, result.PerDay));
    }

    [Fact]
    public async Task DiapersAverage_UsesTheLocalDayNotTheUtcDay()
    {
        var baby = await BabyAsync((id, user) => new[] { 7, 8, 9 }.SelectMany(day => new[] { Local(day, 22), Local(day, 23, 30) }).Select(at => Log(id, user, BuiltInEventTypes.DiaperId, at, at, """{"content":"WET"}""")));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDiapersAverageAsync(Invocation()));

        Assert.Equal((AssistantResultCode.DiapersAverage, 3, 2.0), (result.Code, result.Count, result.PerDay));
    }

    [Fact]
    public async Task BottleAverage_SixBottles_AveragesTheLastFiveAndNamesTheLast()
    {
        var amounts = new (int Day, int Ml)[] { (3, 200), (4, 100), (5, 110), (6, 120), (8, 130), (9, 140) };
        var baby = await BabyAsync((id, user) => amounts.SelectMany(entry => Feeds(id, user, [Local(entry.Day, 12)], entry.Ml)));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadBottleAverageAsync(Invocation()));

        Assert.Equal(AssistantResultCode.BottleAverage, result.Code);
        Assert.Equal((5, 120, 140, Local(9, 12)), (result.Count, result.AmountMl, result.LastAmountMl, result.At));
    }

    [Fact]
    public async Task BottleAverage_TwoBottlesOrOldOnes_IsNotEnough()
    {
        var baby = await BabyAsync((id, user) => Feeds(id, user, [Local(9, 12), Local(9, 18), Local(10, 1).AddDays(-20)]));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadBottleAverageAsync(Invocation()));

        Assert.Equal((AssistantResultCode.NoBottleData, 2), (result.Code, result.Count));
    }

    [Fact]
    public async Task BottleAverage_BreastAndSolidFeeds_AreNotBottles()
    {
        var baby = await BabyAsync((id, user) => Enumerable.Range(5, 5).Select(day => Log(id, user, BuiltInEventTypes.FeedingId, Local(day, 8), Local(day, 8, 15), """{"method":"breast","side":"left"}""")));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadBottleAverageAsync(Invocation()));

        Assert.Equal((AssistantResultCode.NoBottleData, 0), (result.Code, result.Count));
    }

    [Fact]
    public async Task SleepToday_CountsTheNightSinceMidnightAndTheRunningNap()
    {
        var baby = await BabyAsync((id, user) => [
            Log(id, user, BuiltInEventTypes.SleepId, Local(9, 21), Local(10, 6), """{"kind":"night"}"""),
            Log(id, user, BuiltInEventTypes.SleepId, Local(10, 8), null, """{"kind":"nap"}"""),
        ]);

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadSleepTodayAsync(Invocation()));

        Assert.Equal((AssistantResultCode.SleepToday, 420, 1), (result.Code, result.Minutes, result.Count));
    }

    [Fact]
    public async Task SleepToday_NothingLogged_IsZero()
    {
        var baby = await BabyAsync((_, _) => []);

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadSleepTodayAsync(Invocation()));

        Assert.Equal((AssistantResultCode.SleepToday, 0, 0), (result.Code, result.Minutes, result.Count));
    }

    [Fact]
    public async Task LastDiaper_TheNewestOne_TellsWhenAndWhat()
    {
        var baby = await BabyAsync((id, user) => new[] { (Local(9, 7), "WET"), (Local(10, 6), "WET"), (Local(10, 8), "DIRTY") }
            .Select(entry => Log(id, user, BuiltInEventTypes.DiaperId, entry.Item1, entry.Item1, $$"""{"content":"{{entry.Item2}}"}""")));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadLastDiaperAsync(Invocation()));

        Assert.Equal((AssistantResultCode.LastDiaper, DiaperKind.Dirty, Local(10, 8)), (result.Code, result.Diaper, result.At));
    }

    [Fact]
    public async Task LastDiaper_NoneInThirtyDays_SaysSo()
    {
        var baby = await BabyAsync((id, user) => [Log(id, user, BuiltInEventTypes.DiaperId, Local(10, 1).AddDays(-40), Local(10, 1).AddDays(-40), """{"content":"WET"}""")]);

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadLastDiaperAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NoDiapers, result.Code);
    }

    [Fact]
    public async Task CryReasons_LongSinceTheLastFeed_PutsHungerFirstWithItsFactAndAlwaysTheRedFlags()
    {
        var baby = await BabyAsync((id, user) => Feeds(id, user, ThreeHourlyFeeds(1)));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadCryReasonsAsync(Invocation()));

        Assert.Equal(AssistantResultCode.CryReasons, result.Code);
        var first = result.CryCauses[0];
        Assert.Equal((CryCause.Hunger, CryLevel.Likely), (first.Cause, first.Level));
        Assert.Contains(first.Facts, fact => fact is { Kind: "sinceLastFeed", Minutes: 480 });
        Assert.InRange(result.CryCauses.Count, 1, 3);
        Assert.DoesNotContain(result.CryCauses, cause => cause.Cause == CryCause.Comfort || cause.Facts.Any(fact => fact.Kind == "noData"));
        Assert.Equal(["fever", "inconsolable", "refusing_feeds", "unusual_sleepiness", "bulging_or_stiff_fontanelle"], result.RedFlags);
    }

    [Fact]
    public async Task CryReasons_NothingLogged_SaysSoAndStillGivesTheRedFlags()
    {
        var baby = await BabyAsync((_, _) => []);

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadCryReasonsAsync(Invocation()));

        Assert.Equal((AssistantResultCode.CryNoData, null, 5), (result.Code, result.Running, result.RedFlags.Count));
        Assert.Empty(result.CryCauses);
    }

    [Fact]
    public async Task CryReasons_ASleepTimerRuns_SaysTheLogMayBeBehind()
    {
        var baby = await BabyAsync((id, user) => Feeds(id, user, ThreeHourlyFeeds(1)).Append(Log(id, user, BuiltInEventTypes.SleepId, Local(10, 8), null, """{"kind":"nap"}""")));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadCryReasonsAsync(Invocation()));

        Assert.Equal((AssistantResultCode.CryNoData, true), (result.Code, result.Running));
        Assert.Equal(5, result.RedFlags.Count);
    }

    [Fact]
    public async Task CryReasons_FeedEndedMinutesAgo_DoesNotCallItHunger()
    {
        var baby = await BabyAsync((id, user) => Feeds(id, user, ThreeHourlyFeeds(7).Append(Local(10, 8, 50))));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadCryReasonsAsync(Invocation()));

        Assert.DoesNotContain(result.CryCauses, cause => cause.Cause == CryCause.Hunger);
    }

    [Fact]
    public async Task EveryNewRead_ViewerIsAllowed_AndDoctorOnlyIsRefused()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer, BabyRole.Doctor);
        Func<IAssistantService, Task<AssistantResult>>[] reads =
        [
            assistant => assistant.ReadNextNapWindowAsync(Invocation()),
            assistant => assistant.ReadNextFeedAsync(Invocation()),
            assistant => assistant.ReadNextDiaperAsync(Invocation()),
            assistant => assistant.ReadDiapersAverageAsync(Invocation()),
            assistant => assistant.ReadBottleAverageAsync(Invocation()),
            assistant => assistant.ReadSleepTodayAsync(Invocation()),
            assistant => assistant.ReadLastDiaperAsync(Invocation()),
            assistant => assistant.ReadCryReasonsAsync(Invocation()),
        ];

        foreach (var read in reads)
        {
            var viewer = await factory.RunAsAsync(baby.SubjectOf(BabyRole.Viewer), read);
            var doctor = await factory.RunAsAsync(baby.SubjectOf(BabyRole.Doctor), read);

            Assert.NotEqual(AssistantResultCode.NotAllowed, viewer.Code);
            Assert.Equal(AssistantResultCode.NotAllowed, doctor.Code);
        }
    }
}
