using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Notifications;

public sealed class NotificationPlannerOvertiredTests
{
    private static readonly NotificationRecipient OvertiredParent = Recipient(doseDue: false, overtiredWarning: true);

    /// <summary>Awake since 13:00 São Paulo with a usual limit of 2h30: the limit is 15:30, the heads-up goes at 15:15.</summary>
    private static readonly DateTimeOffset AwakeSince = At(13, 0);

    private static readonly NotificationKey Stretch = NotificationKey.ForOvertired(BabyId, AwakeSince);

    private static NotificationPlan PlanOvertired(
        DateTimeOffset now,
        DateTimeOffset? awakeSince = null,
        bool asleep = false,
        NotificationRecipient? recipient = null,
        IReadOnlyList<NotificationAction>? actions = null,
        params DeliveredNotification[] delivered) =>
        Plan(now, [recipient ?? OvertiredParent], [], actions, delivered, wakeWindows: [WakeState(asleep ? null : awakeSince ?? AwakeSince)]);

    [Fact]
    public void Plan_FifteenMinutesBeforeTheLimit_PlansOneKeyedByTheStretchStart()
    {
        var plan = PlanOvertired(At(15, 15));

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal($"overtired:{BabyId:N}:202603021600", planned.BaseKey.Value);
        Assert.Equal((NotificationKind.OvertiredWarning, NotificationUrgency.Normal), (planned.Kind, planned.Urgency));
        Assert.Equal(At(15, 15), planned.DueAt);
        Assert.Equal(new NotificationContent(BabyId, null, At(15, 30), null), planned.Content);
        Assert.Equal(TimeSpan.FromMinutes(45), planned.TimeToLive);
        Assert.Equal("overtired_warning", NotificationCodes.Of(planned.Kind));
    }

    [Fact]
    public void Plan_BeforeTheSendTime_PlansNothing()
    {
        var plan = PlanOvertired(At(15, 14));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_AlreadyClaimedForTheStretch_PlansItOnlyOnce()
    {
        var plan = PlanOvertired(At(15, 20), delivered: new DeliveredNotification(MomId, Stretch));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_ANewStretchAfterANap_HasItsOwnKey()
    {
        var later = At(16, 10);

        var plan = PlanOvertired(At(18, 25), awakeSince: later, delivered: new DeliveredNotification(MomId, Stretch));

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal(NotificationKey.ForOvertired(BabyId, later), planned.BaseKey);
    }

    [Fact]
    public void Plan_SleepStarted_PlansNothing()
    {
        var plan = PlanOvertired(At(15, 15), asleep: true);

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Theory]
    [InlineData(15, true)]
    [InlineData(16, false)]
    public void Plan_StaleCutoff_IsFifteenMinutesAfterTheSendTime(int minutesAfterSend, bool planned)
    {
        var plan = PlanOvertired(At(15, 15).AddMinutes(minutesAfterSend));

        Assert.Equal(planned, plan.Notifications.Count == 1);
        Assert.Equal(!planned, plan.Skipped.Any(skipped => skipped.Reason == NotificationSkipReason.Stale));
    }

    [Fact]
    public void Plan_FromThirtyMinutesAfterTheLimit_PlansNothing()
    {
        var plan = PlanOvertired(At(16, 0));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_InsideQuietHours_IsDropped()
    {
        var plan = PlanOvertired(At(22, 20), awakeSince: At(20, 5));

        Assert.Empty(plan.Notifications);
        Assert.Equal([(MomId, NotificationSkipReason.QuietHours)], plan.Skipped.Select(skipped => (skipped.UserId, skipped.Reason)));
    }

    [Fact]
    public void Plan_KindOffViewerNoZoneOrNoWakeWindow_PlansNothing()
    {
        var off = PlanOvertired(At(15, 15), recipient: Recipient(doseDue: false, fussyPattern: true));
        var viewer = PlanOvertired(At(15, 15), recipient: Recipient(role: BabyRole.Viewer, doseDue: false, overtiredWarning: true));
        var noZone = PlanOvertired(At(15, 15), recipient: Recipient(doseDue: false, overtiredWarning: true, withoutZone: true));
        var noWindow = Plan(At(15, 15), [OvertiredParent], [], wakeWindows: [new WakeWindowState(SaoPauloZone, null)]);
        var notLoaded = Plan(At(15, 15), [OvertiredParent], []);

        Assert.All(new[] { off, viewer, noZone, noWindow, notLoaded }, plan => Assert.Empty(plan.Notifications));
    }

    [Fact]
    public void Plan_SnoozeOver_ResendsBeforeTheExpiry()
    {
        var snooze = NotificationAction.Snooze(MomId, BabyId, Stretch, At(15, 16));

        var plan = PlanOvertired(At(15, 46), actions: [snooze], delivered: new DeliveredNotification(MomId, Stretch));

        var resend = Assert.Single(plan.Notifications);
        Assert.Equal((Stretch, Stretch.Snoozed(1), At(15, 46)), (resend.BaseKey, resend.DedupeKey, resend.DueAt));
        Assert.Equal(TimeSpan.FromMinutes(14), resend.TimeToLive);
    }

    [Fact]
    public void Key_Overtired_RoundTripsAndIsNotADose()
    {
        var key = NotificationKey.From(Stretch.Snoozed(2).Value);

        Assert.Equal(Stretch, key.Base);
        Assert.False(key.TryGetDose(out _, out _));
    }
}
