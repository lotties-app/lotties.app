using Lotties.Domain.Exceptions;
using Lotties.Domain.Notifications;
using Lotties.Domain.Prescriptions;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Notifications;

public sealed class NotificationPlannerSnoozeTests
{
    private static readonly Guid MedicationA = Guid.NewGuid();
    private static readonly Prescription Morning = AtTimes(MedicationA, ["08:00"]);
    private static readonly NotificationKey MorningKey = NotificationKey.ForDose(Morning.Id, At(8));
    private static readonly DeliveredNotification MomGotIt = new(MomId, MorningKey);

    private static NotificationPlan PlanMorning(DateTimeOffset now, IReadOnlyList<NotificationAction> actions, IReadOnlyCollection<DeliveredNotification> delivered, params MedicationDose[] doses) =>
        Plan(now, [Recipient(MomId), Recipient(DadId)], [State(Statuses([Morning], now, doses))], actions, delivered);

    [Fact]
    public void Plan_SnoozeNotOver_HoldsTheResendForThatUserOnly()
    {
        var snooze = NotificationAction.Snooze(MomId, BabyId, MorningKey, At(8, 2));

        var plan = PlanMorning(At(8, 20), [snooze], [MomGotIt]);

        Assert.Equal([(DadId, MorningKey)], plan.Notifications.Select(planned => (planned.UserId, planned.DedupeKey)));
        Assert.Equal([(MomId, MorningKey.Snoozed(1), NotificationSkipReason.Snoozed)], plan.Skipped.Select(skipped => (skipped.UserId, skipped.DedupeKey, skipped.Reason)));
    }

    [Fact]
    public void Plan_SnoozeOver_ResendsWithTheSnoozeKeyAtTheSnoozeEnd()
    {
        var snooze = NotificationAction.Snooze(MomId, BabyId, MorningKey, At(8, 2));
        var dadGotIt = new DeliveredNotification(DadId, MorningKey);

        var plan = PlanMorning(At(8, 33), [snooze], [MomGotIt, dadGotIt]);

        var resend = Assert.Single(plan.Notifications);
        Assert.Equal((MomId, MorningKey, MorningKey.Snoozed(1)), (resend.UserId, resend.BaseKey, resend.DedupeKey));
        Assert.Equal(At(8, 32), resend.DueAt);
        Assert.True(resend.IsResend);
    }

    [Fact]
    public void Plan_ThirdSnooze_UsesTheThirdResendKey()
    {
        var snooze = NotificationAction.Snooze(MomId, BabyId, MorningKey, At(8, 0));
        snooze.Snooze(At(8, 30));
        snooze.Snooze(At(9, 0));
        var delivered = new[] { MomGotIt, new DeliveredNotification(MomId, MorningKey.Snoozed(1)), new DeliveredNotification(MomId, MorningKey.Snoozed(2)), new DeliveredNotification(DadId, MorningKey) };

        var plan = PlanMorning(At(9, 30), [snooze], delivered);

        Assert.Equal([MorningKey.Snoozed(3)], plan.Notifications.Select(planned => planned.DedupeKey));
        Assert.Throws<SnoozeLimitReachedException>(() => snooze.Snooze(At(9, 31)));
    }

    [Fact]
    public void Plan_ResendAlreadyClaimed_PlansNothingMore()
    {
        var snooze = NotificationAction.Snooze(MomId, BabyId, MorningKey, At(8, 2));
        var delivered = new[] { MomGotIt, new DeliveredNotification(MomId, MorningKey.Snoozed(1)), new DeliveredNotification(DadId, MorningKey) };

        var plan = PlanMorning(At(8, 40), [snooze], delivered);

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_DoseLoggedDuringSnooze_CancelsTheResend()
    {
        var snooze = NotificationAction.Snooze(MomId, BabyId, MorningKey, At(8, 2));

        var plan = PlanMorning(At(8, 33), [snooze], [MomGotIt], Dose(At(8, 20), MedicationA, Morning.Id));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_DismissedAfterSnooze_StopsOnlyThatUsersResend()
    {
        var momSnooze = NotificationAction.Snooze(MomId, BabyId, MorningKey, At(8, 2));
        var dadSnooze = NotificationAction.Snooze(DadId, BabyId, MorningKey, At(8, 2));
        momSnooze.Dismiss(At(8, 10));

        var plan = PlanMorning(At(8, 33), [momSnooze, dadSnooze], [MomGotIt, new DeliveredNotification(DadId, MorningKey)]);

        Assert.Equal([DadId], plan.Notifications.Select(planned => planned.UserId));
        Assert.Equal([(MomId, NotificationSkipReason.Dismissed)], plan.Skipped.Select(skipped => (skipped.UserId, skipped.Reason)));
    }

    [Fact]
    public void Plan_DismissedBeforeAnySend_SkipsTheBaseReminder()
    {
        var dismissal = NotificationAction.Dismiss(MomId, BabyId, MorningKey, At(7, 0));

        var plan = PlanMorning(At(8, 0), [dismissal], []);

        Assert.Equal([DadId], plan.Notifications.Select(planned => planned.UserId));
        Assert.Equal([(MomId, NotificationSkipReason.Dismissed)], plan.Skipped.Select(skipped => (skipped.UserId, skipped.Reason)));
    }

    [Fact]
    public void Plan_SnoozeEndedLongAgo_IsStale()
    {
        var snooze = NotificationAction.Snooze(MomId, BabyId, MorningKey, At(8, 2));
        var dadGotIt = new DeliveredNotification(DadId, MorningKey);

        var plan = PlanMorning(At(9, 3), [snooze], [MomGotIt, dadGotIt]);

        Assert.Empty(plan.Notifications);
        Assert.Equal([(MorningKey.Snoozed(1), NotificationSkipReason.Stale)], plan.Skipped.Select(skipped => (skipped.DedupeKey, skipped.Reason)));
    }

    [Fact]
    public void Plan_SnoozeResendInQuietHours_DroppedForNap()
    {
        var anchor = At(12, 30);
        var napKey = NotificationKey.ForNap(BabyId, anchor);
        var snooze = NotificationAction.Snooze(MomId, BabyId, napKey, At(14, 0));
        var quietAfternoon = QuietHours.Create(true, new TimeOnly(14, 15), new TimeOnly(16, 0));
        var recipient = Recipient(doseDue: false, napWindow: true, quietHours: quietAfternoon);

        var plan = Plan(At(14, 31), [recipient], [State([], NapWindow(anchor, At(14, 0), At(15, 30)))], [snooze], [new DeliveredNotification(MomId, napKey)]);

        Assert.Equal([(napKey.Snoozed(1), NotificationSkipReason.QuietHours)], plan.Skipped.Select(skipped => (skipped.DedupeKey, skipped.Reason)));
    }

    [Fact]
    public void Plan_ActionOfAnotherBaby_IsIgnored()
    {
        var otherBaby = NotificationAction.Dismiss(MomId, Guid.NewGuid(), MorningKey, At(7, 0));

        var plan = PlanMorning(At(8, 0), [otherBaby], []);

        Assert.Equal(new[] { DadId, MomId }.Order(), plan.Notifications.Select(planned => planned.UserId));
    }

    [Fact]
    public void PlanTest_UsesTheDeliveryIdKeyAndAShortTimeToLive()
    {
        var deliveryId = Guid.NewGuid();
        var now = At(23);

        var planned = NotificationPlanner.PlanTest(MomId, deliveryId, now);

        Assert.Equal(($"test:{deliveryId:N}", NotificationKind.Test, (Guid?)null), (planned.DedupeKey.Value, planned.Kind, planned.BabyId));
        Assert.Equal((now, TimeSpan.FromMinutes(5), NotificationUrgency.Normal), (planned.DueAt, planned.TimeToLive, planned.Urgency));
    }
}
