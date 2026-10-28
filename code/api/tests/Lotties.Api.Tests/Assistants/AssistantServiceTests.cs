using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using static Lotties.Api.Tests.Assistants.AssistantTestKit;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The assistant command layer over the real services and database (docs/design/32-assistants.md): every command's success,
/// idempotent replay of the same request id, the roles (Owner, Parent, Caregiver own entries and others' running timers,
/// Viewer and Doctor refused), the baby choice, limits, and language-neutral results.
/// </summary>
public sealed class AssistantServiceTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static DateTimeOffset Now => DateTimeOffset.UtcNow;

    private Task<SeededBaby> FamilyAsync() => factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor);

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    public async Task LogSleepStart_FamilyRolesThatLog_StartSleepTimerCreatedByTheUser(BabyRole role)
    {
        var baby = await FamilyAsync();
        var subject = baby.SubjectOf(role);

        var result = await factory.RunAsAsync(subject, assistant => assistant.LogSleepStartAsync(Invocation()));

        var stored = Assert.Single(await factory.EventsAsync(baby.BabyId));
        Assert.Equal(AssistantResultCode.SleepStarted, result.Code);
        Assert.Equal(baby.BabyId, result.Baby!.Id);
        Assert.Null(result.Baby.Name);
        Assert.Equal(BuiltInEventTypes.SleepId, stored.TypeId);
        Assert.True(stored.IsRunning);
        Assert.Equal(await factory.UserIdAsync(subject), stored.CreatedBy);
        Assert.Contains(PayloadOf(stored).GetProperty("kind").GetString(), new[] { SleepKinds.Nap, SleepKinds.Night });
    }

    [Theory]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Doctor)]
    public async Task Writes_ViewerAndDoctor_AreNotAllowedAndWriteNothing(BabyRole role)
    {
        var baby = await FamilyAsync();
        var subject = baby.SubjectOf(role);

        var results = new[]
        {
            await factory.RunAsAsync(subject, assistant => assistant.LogSleepStartAsync(Invocation())),
            await factory.RunAsAsync(subject, assistant => assistant.LogSleepEndAsync(Invocation())),
            await factory.RunAsAsync(subject, assistant => assistant.LogBottleAsync(Invocation(), 120, BottleKind.Formula)),
            await factory.RunAsAsync(subject, assistant => assistant.LogNursingAsync(Invocation(), BreastSide.Left)),
            await factory.RunAsAsync(subject, assistant => assistant.LogDiaperAsync(Invocation(), DiaperKind.Wet)),
        };

        Assert.All(results, result => Assert.Equal(AssistantResultCode.NotAllowed, result.Code));
        Assert.Empty(await factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task Reads_Viewer_IsAllowed()
    {
        var baby = await FamilyAsync();

        var result = await factory.RunAsAsync(baby.SubjectOf(BabyRole.Viewer), assistant => assistant.ReadLastFeedAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NoFeeds, result.Code);
        Assert.Equal(baby.BabyId, result.Baby!.Id);
    }

    [Fact]
    public async Task Reads_DoctorOnlyMember_AreNotAllowedWithoutNamingTheBaby()
    {
        var baby = await FamilyAsync();

        var results = new[]
        {
            await factory.RunAsAsync(baby.SubjectOf(BabyRole.Doctor), assistant => assistant.ReadLastFeedAsync(Invocation())),
            await factory.RunAsAsync(baby.SubjectOf(BabyRole.Doctor), assistant => assistant.ReadDueVaccinesAsync(Invocation())),
        };

        Assert.All(results, result => Assert.Equal((AssistantResultCode.NotAllowed, (AssistantBaby?)null), (result.Code, result.Baby)));
    }

    [Fact]
    public async Task LogSleepStart_SameRequestIdTwice_LogsOnceAndAnswersTheSame()
    {
        var baby = await factory.SeedBabyAsync();
        var invocation = Invocation("retried-request");

        var first = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepStartAsync(invocation));
        var replay = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepStartAsync(invocation));

        Assert.Single(await factory.EventsAsync(baby.BabyId));
        Assert.Equal((first.Code, first.At), (replay.Code, replay.At));
    }

    [Fact]
    public async Task LogSleepStart_WhileASleepRuns_IsAlreadyRunning()
    {
        var baby = await factory.SeedBabyAsync();
        var since = Now.AddMinutes(-40);
        await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.SleepId, since, null, """{"kind":"nap"}""");

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepStartAsync(Invocation()));

        Assert.Equal(AssistantResultCode.SleepAlreadyRunning, result.Code);
        Assert.Equal(since.ToUnixTimeSeconds(), result.At!.Value.ToUnixTimeSeconds());
        Assert.Single(await factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task LogSleepStart_AfterABedTime_StartsANight()
    {
        var baby = await factory.SeedBabyAsync();
        var bedTime = Now.AddMinutes(-20);
        await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.SleepId, bedTime, bedTime, """{"kind":"bed_time"}""");

        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepStartAsync(Invocation()));

        var timer = Assert.Single(await factory.EventsAsync(baby.BabyId), stored => stored.IsRunning);
        Assert.Equal(SleepKinds.Night, PayloadOf(timer).GetProperty("kind").GetString());
    }

    [Fact]
    public async Task LogSleepEnd_RunningSleep_StopsItLogsTheWakeUpAndReplaysTheSame()
    {
        var baby = await factory.SeedBabyAsync();
        var sleepId = await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.SleepId, Now.AddMinutes(-95), null, """{"kind":"nap"}""");
        var invocation = Invocation("wake-request");

        var ended = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepEndAsync(invocation));
        var replay = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepEndAsync(invocation));

        var events = await factory.EventsAsync(baby.BabyId);
        var sleep = events.Single(stored => stored.Id == sleepId);
        var marker = Assert.Single(events, stored => stored.Id != sleepId);
        Assert.Equal(AssistantResultCode.SleepEnded, ended.Code);
        Assert.InRange(ended.Minutes!.Value, 94, 96);
        Assert.Equal((ended.Code, ended.At, ended.Minutes), (replay.Code, replay.At, replay.Minutes));
        Assert.Equal(sleep.EndedAt, marker.StartedAt);
        Assert.Equal(SleepKinds.WokeUp, PayloadOf(marker).GetProperty("kind").GetString());
        Assert.Equal(marker.StartedAt, marker.EndedAt);
    }

    [Fact]
    public async Task LogSleepEnd_PausedSleep_FoldsTheOpenPause()
    {
        var baby = await factory.SeedBabyAsync();
        var pausedAt = Now.AddMinutes(-10).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'");
        var sleepId = await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.SleepId, Now.AddMinutes(-60), null, $$"""{"kind":"nap","pause_count":1,"paused_seconds":300,"paused_at":"{{pausedAt}}"}""");

        var ended = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepEndAsync(Invocation()));

        var payload = PayloadOf(await factory.EventAsync(sleepId));
        Assert.False(payload.TryGetProperty("paused_at", out _));
        Assert.InRange(payload.GetProperty("paused_seconds").GetInt32(), 895, 990);
        Assert.InRange(ended.Minutes!.Value, 44, 46);
    }

    [Fact]
    public async Task LogSleepEnd_CaregiverAndSomeoneElsesRunningSleep_StopsIt()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var sleepId = await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.SleepId, Now.AddMinutes(-30), null, """{"kind":"nap"}""");

        var result = await factory.RunAsAsync(baby.SubjectOf(BabyRole.Caregiver), assistant => assistant.LogSleepEndAsync(Invocation()));

        Assert.Equal(AssistantResultCode.SleepEnded, result.Code);
        Assert.NotNull((await factory.EventAsync(sleepId)).EndedAt);
    }

    [Fact]
    public async Task LogSleepEnd_NothingRunning_IsNoRunningSleepAndWritesNothing()
    {
        var baby = await factory.SeedBabyAsync();

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepEndAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NoRunningSleep, result.Code);
        Assert.Empty(await factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task LogSleepEnd_TwoRunning_IsSeveralRunningSleepsAndChangesNothing()
    {
        var baby = await factory.SeedBabyAsync();
        await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.SleepId, Now.AddMinutes(-30), null, """{"kind":"nap"}""");
        await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.SleepId, Now.AddMinutes(-20), null, "{}");

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepEndAsync(Invocation()));

        Assert.Equal((AssistantResultCode.SeveralRunningSleeps, 2), (result.Code, result.Count));
        Assert.All(await factory.EventsAsync(baby.BabyId), stored => Assert.True(stored.IsRunning));
    }

    [Fact]
    public async Task LogBottle_FormulaWithACurrentFormula_NamesIt()
    {
        var baby = await factory.SeedBabyAsync();
        var formulaId = Guid.NewGuid();
        var put = await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/formulas/{formulaId}", new { name = "Nan 1", isCurrent = true });
        put.EnsureSuccessStatusCode();

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBottleAsync(Invocation(), 120, BottleKind.Formula));

        var payload = PayloadOf(Assert.Single(await factory.EventsAsync(baby.BabyId)));
        Assert.Equal((AssistantResultCode.BottleLogged, 120, BottleKind.Formula), (result.Code, result.AmountMl, result.BottleKind));
        Assert.Equal("bottle", payload.GetProperty("method").GetString());
        Assert.Equal(120, payload.GetProperty("amount_ml").GetInt32());
        Assert.Equal("formula", payload.GetProperty("bottle_feeding_type").GetString());
        Assert.Equal(formulaId, payload.GetProperty("formula_id").GetGuid());
    }

    [Theory]
    [InlineData(BottleKind.Formula, "formula")]
    [InlineData(BottleKind.BreastMilk, "breast_milk")]
    [InlineData(BottleKind.Unspecified, null)]
    public async Task LogBottle_WithoutACurrentFormula_StoresOnlyTheKind(BottleKind kind, string? stored)
    {
        var baby = await factory.SeedBabyAsync();

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBottleAsync(Invocation(), 90, kind));

        var bottle = Assert.Single(await factory.EventsAsync(baby.BabyId));
        var payload = PayloadOf(bottle);
        Assert.Equal(AssistantResultCode.BottleLogged, result.Code);
        Assert.Equal(stored, payload.TryGetProperty("bottle_feeding_type", out var content) ? content.GetString() : null);
        Assert.False(payload.TryGetProperty("formula_id", out _));
        Assert.Equal(bottle.StartedAt, bottle.EndedAt);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(501)]
    public async Task LogBottle_AmountOutsideTheLimits_IsInvalidAmountAndLogsNothing(int? amount)
    {
        var baby = await factory.SeedBabyAsync();

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBottleAsync(Invocation(), amount, BottleKind.Unspecified));

        Assert.Equal((AssistantResultCode.InvalidAmount, AssistantLimits.BottleMinMl, AssistantLimits.BottleMaxMl), (result.Code, result.Min!.Value, result.Max!.Value));
        Assert.Empty(await factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task LogBottle_Replay_LogsOnce()
    {
        var baby = await factory.SeedBabyAsync();
        var invocation = Invocation();

        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBottleAsync(invocation, 60, BottleKind.BreastMilk));
        var replay = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBottleAsync(invocation, 60, BottleKind.BreastMilk));

        Assert.Single(await factory.EventsAsync(baby.BabyId));
        Assert.Equal((AssistantResultCode.BottleLogged, 60, BottleKind.BreastMilk), (replay.Code, replay.AmountMl, replay.BottleKind));
    }

    [Fact]
    public async Task LogNursing_NoSide_StartsOppositeToTheLastFeedAndRefusesASecond()
    {
        var baby = await factory.SeedBabyAsync();
        await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.FeedingId, Now.AddHours(-3), Now.AddHours(-3).AddMinutes(15), """{"method":"breast","side":"both","last_side":"left"}""");

        var started = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogNursingAsync(Invocation(), side: null));
        var second = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogNursingAsync(Invocation(), BreastSide.Left));

        var running = Assert.Single(await factory.EventsAsync(baby.BabyId), stored => stored.IsRunning);
        Assert.Equal((AssistantResultCode.NursingStarted, BreastSide.Right), (started.Code, started.Side));
        Assert.Equal("right", PayloadOf(running).GetProperty("side").GetString());
        Assert.True(PayloadOf(running).TryGetProperty("side_since", out _));
        Assert.Equal(AssistantResultCode.NursingAlreadyRunning, second.Code);
    }

    [Theory]
    [InlineData(DiaperKind.Wet, "WET")]
    [InlineData(DiaperKind.Dirty, "DIRTY")]
    [InlineData(DiaperKind.Both, "MIXED")]
    public async Task LogDiaper_EachKind_StoresItsContentOnceOnReplay(DiaperKind kind, string content)
    {
        var baby = await factory.SeedBabyAsync();
        var invocation = Invocation();

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogDiaperAsync(invocation, kind));
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogDiaperAsync(invocation, kind));

        var diaper = Assert.Single(await factory.EventsAsync(baby.BabyId));
        Assert.Equal((AssistantResultCode.DiaperLogged, kind), (result.Code, result.Diaper!.Value));
        Assert.Equal(content, PayloadOf(diaper).GetProperty("content").GetString());
    }

    [Fact]
    public async Task BabyChoice_NoBaby_IsNoBaby()
    {
        var subject = TestUsers.NewSubject();

        var result = await factory.RunAsAsync(subject, assistant => assistant.ReadSleepStatusAsync(Invocation()));

        Assert.Equal((AssistantResultCode.NoBaby, (AssistantBaby?)null), (result.Code, result.Baby));
    }

    [Fact]
    public async Task BabyChoice_SeveralBabiesWithoutDefault_IsChooseBabyThenTheStoredDefault()
    {
        var (subject, babyIds) = await factory.SeedMemberOfAsync(BabyRole.Parent, BabyRole.Caregiver);

        var before = await factory.RunAsAsync(subject, assistant => assistant.LogDiaperAsync(Invocation(), DiaperKind.Wet));
        var saved = await factory.CreateClientFor(subject).PutAsJsonAsync("/api/v1/me/assistant-settings", new { defaultBabyId = babyIds[1] });
        var after = await factory.RunAsAsync(subject, assistant => assistant.LogDiaperAsync(Invocation(), DiaperKind.Wet));

        saved.EnsureSuccessStatusCode();
        Assert.Equal(AssistantResultCode.ChooseBaby, before.Code);
        Assert.Equal((AssistantResultCode.DiaperLogged, babyIds[1]), (after.Code, after.Baby!.Id));
        Assert.Single(await factory.EventsAsync(babyIds[1]));
    }

    [Fact]
    public async Task BabyChoice_OneBabyToLogAndOneToView_UsesTheOneToLog()
    {
        var (subject, babyIds) = await factory.SeedMemberOfAsync(BabyRole.Viewer, BabyRole.Caregiver);

        var result = await factory.RunAsAsync(subject, assistant => assistant.LogSleepStartAsync(Invocation()));

        Assert.Equal((AssistantResultCode.SleepStarted, babyIds[1]), (result.Code, result.Baby!.Id));
    }

    [Fact]
    public async Task BabyChoice_StoredDefaultTheUserLeft_IsIgnored()
    {
        var (subject, babyIds) = await factory.SeedMemberOfAsync(BabyRole.Parent, BabyRole.Parent, BabyRole.Parent);
        (await factory.CreateClientFor(subject).PutAsJsonAsync("/api/v1/me/assistant-settings", new { defaultBabyId = babyIds[0] })).EnsureSuccessStatusCode();
        (await factory.CreateClientFor(subject).DeleteAsync($"/api/v1/babies/{babyIds[0]}/members/me")).EnsureSuccessStatusCode();

        var result = await factory.RunAsAsync(subject, assistant => assistant.ReadLastFeedAsync(Invocation()));

        Assert.Equal(AssistantResultCode.ChooseBaby, result.Code);
    }

    [Fact]
    public async Task ReadLastFeed_Bottle_TellsItsFacts()
    {
        var baby = await factory.SeedBabyAsync();
        await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.FeedingId, Now.AddHours(-5), Now.AddHours(-5), """{"method":"breast","side":"left"}""");
        var at = Now.AddMinutes(-70);
        await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.FeedingId, at, at.AddMinutes(10), """{"method":"bottle","amount_ml":150,"amount_drunk_ml":110,"bottle_feeding_type":"breast_milk"}""");

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadLastFeedAsync(Invocation()));

        Assert.Equal((AssistantResultCode.LastFeed, FeedMethod.Bottle, 110, BottleKind.BreastMilk, false, 10), (result.Code, result.FeedMethod!.Value, result.AmountMl!.Value, result.BottleKind!.Value, result.Running!.Value, result.Minutes!.Value));
        Assert.Equal(at.ToUnixTimeSeconds(), result.At!.Value.ToUnixTimeSeconds());
    }

    [Fact]
    public async Task ReadSleepStatus_SleepingAwakeAndNone()
    {
        var sleeping = await factory.SeedBabyAsync();
        await factory.PutEventAsync(sleeping.OwnerSubject, sleeping.BabyId, BuiltInEventTypes.SleepId, Now.AddMinutes(-25), null, """{"kind":"nap"}""");
        var awake = await factory.SeedBabyAsync();
        await factory.PutEventAsync(awake.OwnerSubject, awake.BabyId, BuiltInEventTypes.SleepId, Now.AddMinutes(-150), Now.AddMinutes(-60), """{"kind":"nap"}""");
        var none = await factory.SeedBabyAsync();

        var asleep = await factory.RunAsAsync(sleeping.OwnerSubject, assistant => assistant.ReadSleepStatusAsync(Invocation()));
        var up = await factory.RunAsAsync(awake.OwnerSubject, assistant => assistant.ReadSleepStatusAsync(Invocation()));
        var nothing = await factory.RunAsAsync(none.OwnerSubject, assistant => assistant.ReadSleepStatusAsync(Invocation()));

        Assert.Equal(AssistantResultCode.Sleeping, asleep.Code);
        Assert.InRange(asleep.Minutes!.Value, 24, 26);
        Assert.Equal((AssistantResultCode.Awake, 90), (up.Code, up.Minutes!.Value));
        Assert.Equal(AssistantResultCode.NoSleeps, nothing.Code);
    }

    [Fact]
    public async Task ReadDiapersToday_WithAndWithoutAZone_CountsWetAndDirty()
    {
        var baby = await factory.SeedBabyAsync();
        await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.DiaperId, Now.AddMinutes(-3), Now.AddMinutes(-3), """{"content":"WET"}""");
        await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.DiaperId, Now.AddMinutes(-2), Now.AddMinutes(-2), """{"content":"MIXED"}""");
        await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.DiaperId, Now.AddHours(-30), Now.AddHours(-30), """{"content":"DIRTY"}""");

        var withoutZone = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDiapersTodayAsync(Invocation()));
        await factory.SetTimeZoneAsync(baby.OwnerSubject, "Etc/UTC");
        var withZone = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDiapersTodayAsync(Invocation()));

        Assert.Equal((AssistantResultCode.DiapersToday, AssistantDayWindow.LastDay, 2, 2, 1, (string?)null), (withoutZone.Code, withoutZone.Window!.Value, withoutZone.Count!.Value, withoutZone.Wet!.Value, withoutZone.Dirty!.Value, withoutZone.TimeZone));
        Assert.Equal((AssistantDayWindow.Today, "Etc/UTC"), (withZone.Window!.Value, withZone.TimeZone));
        Assert.InRange(withZone.Count!.Value, 0, 2);
    }

    [Fact]
    public async Task ReadDiapersToday_FallbackZone_IsUsedWithoutAStoredOne()
    {
        var baby = await factory.SeedBabyAsync();

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDiapersTodayAsync(Invocation(fallbackZone: "America/Sao_Paulo")));

        Assert.Equal((AssistantDayWindow.Today, "America/Sao_Paulo", 0), (result.Window!.Value, result.TimeZone, result.Count!.Value));
    }

    [Fact]
    public async Task ReadNextAppointment_UpcomingAndNone()
    {
        var baby = await factory.SeedBabyAsync();
        var none = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextAppointmentAsync(Invocation()));
        var startsAt = Now.AddDays(2);
        var put = await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/appointments/{Guid.NewGuid()}", new { title = "Pediatra", type = "consultation", startsAt });
        put.EnsureSuccessStatusCode();

        var next = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextAppointmentAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NoAppointment, none.Code);
        Assert.Equal((AssistantResultCode.NextAppointment, "consultation"), (next.Code, next.Appointment!.Type));
        Assert.DoesNotContain("Pediatra", JsonSerializer.Serialize(next), StringComparison.Ordinal);
    }

    [Fact]
    public async Task ReadDueVaccines_NewbornWithoutRecords_TellsTheDueDosesByTheSchedule()
    {
        var baby = await factory.SeedBabyAsync();

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDueVaccinesAsync(Invocation()));

        Assert.Equal(AssistantResultCode.VaccinesDue, result.Code);
        Assert.True(result.Count > 0);
        Assert.NotEmpty(result.Vaccines);
        Assert.All(result.Vaccines, dose => Assert.True(dose.Names.ContainsKey("en") && dose.Names.ContainsKey("pt-BR")));
    }

    [Fact]
    public async Task Results_AreLanguageNeutralJsonWithSnakeCaseCodes()
    {
        var baby = await factory.SeedBabyAsync();

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogDiaperAsync(Invocation(), DiaperKind.Both));
        var json = JsonSerializer.SerializeToElement(result, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Equal("diaper_logged", json.GetProperty("code").GetString());
        Assert.Equal("both", json.GetProperty("diaper").GetString());
        Assert.Equal("diaper_logged", Code(result));
        Assert.DoesNotContain(json.EnumerateObject(), member => member.Name is "text" or "speech" or "message");
    }

    [Fact]
    public async Task Invocation_BlankRequestId_IsAnAdapterBug()
    {
        var baby = await factory.SeedBabyAsync();

        await Assert.ThrowsAnyAsync<ArgumentException>(() => factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepStartAsync(new AssistantInvocation("test", " "))));
    }
}
