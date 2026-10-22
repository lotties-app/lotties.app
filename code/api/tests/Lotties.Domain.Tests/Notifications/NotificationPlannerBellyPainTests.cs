using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Lotties.Domain.Patterns;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Notifications;

public sealed class NotificationPlannerBellyPainTests
{
    private static readonly NotificationRecipient BellyParent = Recipient(doseDue: false, bellyPainPattern: true);

    /// <summary>Usual window 17:30-18:30 (São Paulo): the heads-up goes at 17:00.</summary>
    private static readonly TimeOfDayPattern Evening = BellyPattern(new TimeOnly(17, 30));

    private static readonly NotificationKey MarchSecond = NotificationKey.ForBellyPain(BabyId, new DateOnly(2026, 3, 2));

    private static NotificationPlan PlanBelly(
        DateTimeOffset now,
        TimeOfDayPattern? pattern = null,
        DateTimeOffset? lastLoggedAt = null,
        NotificationRecipient? recipient = null,
        IReadOnlyList<NotificationAction>? actions = null,
        params DeliveredNotification[] delivered) =>
        Plan(now, [recipient ?? BellyParent], [], actions, delivered, bellyPain: [BellyState(pattern ?? Evening, lastLoggedAt)]);

    [Fact]
    public void Plan_PatternExists_PlansThirtyMinutesBeforeTheWindowKeyedByLocalDate()
    {
        var plan = PlanBelly(At(17, 0));

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal($"belly:{BabyId:N}:20260302", planned.BaseKey.Value);
        Assert.Equal((NotificationKind.BellyPainPattern, NotificationUrgency.Normal), (planned.Kind, planned.Urgency));
        Assert.Equal(At(17, 0), planned.DueAt);
        Assert.Equal(new NotificationContent(BabyId, null, At(17, 30), null), planned.Content);
        Assert.Equal(TimeSpan.FromMinutes(105), planned.TimeToLive);
        Assert.Equal("belly_pain_pattern", NotificationCodes.Of(planned.Kind));
    }

    [Fact]
    public void Plan_BeforeTheSendTime_PlansNothing()
    {
        var plan = PlanBelly(At(16, 59));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_AlreadyClaimedForTheDay_PlansItOnlyOnce()
    {
        var plan = PlanBelly(At(17, 5), delivered: new DeliveredNotification(MomId, MarchSecond));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Theory]
    [InlineData(16, 44, true)]
    [InlineData(16, 45, false)]
    [InlineData(17, 2, false)]
    public void Plan_PainOrMassageLoggedFromFortyFiveMinutesBefore_SkipsTheDay(int hour, int minute, bool planned)
    {
        var plan = PlanBelly(At(17, 5), lastLoggedAt: At(hour, minute));

        Assert.Equal(planned, plan.Notifications.Count == 1);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_InsideQuietHours_IsDroppedEvenWhenMedicineIsDelivered()
    {
        var late = BellyPattern(new TimeOnly(22, 40));
        var recipient = Recipient(doseDue: true, bellyPainPattern: true, quietIncludesMedicine: false);

        var plan = PlanBelly(At(22, 10), late, recipient: recipient);

        Assert.Empty(plan.Notifications);
        Assert.Equal([(MomId, NotificationSkipReason.QuietHours)], plan.Skipped.Select(skipped => (skipped.UserId, skipped.Reason)));
    }

    [Fact]
    public void Plan_QuietHoursOff_IsPlannedLateInTheEvening()
    {
        var late = BellyPattern(new TimeOnly(22, 40));
        var recipient = Recipient(doseDue: false, bellyPainPattern: true, quietHours: QuietHours.Create(false, new TimeOnly(22, 0), new TimeOnly(7, 0)));

        var plan = PlanBelly(At(22, 10), late, recipient: recipient);

        Assert.Single(plan.Notifications);
    }

    [Fact]
    public void Plan_KindTurnedOff_PlansNothing()
    {
        var plan = PlanBelly(At(17, 0), recipient: Recipient(doseDue: true, bellyPainPattern: false));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_NoPatternViewerOrNoZone_PlansNothing()
    {
        var noPattern = Plan(At(17, 0), [BellyParent], [], bellyPain: [BellyState(null)]);
        var viewer = PlanBelly(At(17, 0), recipient: Recipient(role: BabyRole.Viewer, doseDue: false, bellyPainPattern: true));
        var noZone = PlanBelly(At(17, 0), recipient: Recipient(doseDue: false, bellyPainPattern: true, withoutZone: true));
        var noState = Plan(At(17, 0), [BellyParent], []);

        Assert.All(new[] { noPattern, viewer, noZone, noState }, plan => Assert.Empty(plan.Notifications));
    }

    [Theory]
    [InlineData(30, true)]
    [InlineData(31, false)]
    public void Plan_StaleCutoff_IsThirtyMinutesAfterTheSendTime(int minutesAfterSend, bool planned)
    {
        var plan = PlanBelly(At(17, 0).AddMinutes(minutesAfterSend));

        Assert.Equal(planned, plan.Notifications.Count == 1);
        Assert.Equal(!planned, plan.Skipped.Any(skipped => skipped.Reason == NotificationSkipReason.Stale));
    }

    [Fact]
    public void Plan_AfterTheWindowEnds_PlansNothing()
    {
        var plan = PlanBelly(At(18, 30));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_WindowStartingAfterMidnight_IsKeyedByTheWindowsDate()
    {
        var afterMidnight = BellyPattern(new TimeOnly(0, 10));
        var recipient = Recipient(doseDue: false, bellyPainPattern: true, quietHours: QuietHours.Create(false, new TimeOnly(22, 0), new TimeOnly(7, 0)));

        var plan = PlanBelly(At(23, 40), afterMidnight, recipient: recipient);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal($"belly:{BabyId:N}:20260303", planned.BaseKey.Value);
        Assert.Equal(At(0, 10, day: 3), planned.Content.At);
    }

    [Fact]
    public void Plan_SnoozeOver_ResendsWhileTheWindowIsOpen()
    {
        var snooze = NotificationAction.Snooze(MomId, BabyId, MarchSecond, At(17, 1));

        var plan = PlanBelly(At(17, 31), actions: [snooze], delivered: new DeliveredNotification(MomId, MarchSecond));

        var resend = Assert.Single(plan.Notifications);
        Assert.Equal((MarchSecond, MarchSecond.Snoozed(1), At(17, 31)), (resend.BaseKey, resend.DedupeKey, resend.DueAt));
    }

    [Fact]
    public void Plan_WithShowNames_NamesTheBabyOnly()
    {
        var names = new NotificationNameSource("Lia", new Dictionary<Guid, string>());
        var recipient = Recipient(doseDue: false, bellyPainPattern: true, showNames: true);

        var plan = Plan(At(17, 0), [recipient], [], names: names, bellyPain: [BellyState(Evening)]);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal(("Lia", (string?)null), (planned.Content.Names!.Baby, planned.Content.Names.Medication));
    }

    [Fact]
    public void Key_BellyPain_RoundTripsAndIsNotADose()
    {
        var key = NotificationKey.From(MarchSecond.Snoozed(2).Value);

        Assert.Equal(MarchSecond, key.Base);
        Assert.False(key.TryGetDose(out _, out _));
        Assert.False(NotificationKey.TryFrom($"belly:{BabyId:N}:2026030", out _));
    }
}
