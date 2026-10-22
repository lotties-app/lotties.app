using Lotties.Domain.Notifications;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Notifications;

public sealed class NotificationPlannerDayPartTests
{
    private static readonly Guid MedicationA = Guid.NewGuid();
    private static readonly Guid MedicationB = Guid.NewGuid();

    [Fact]
    public void Plan_AtTheReminderTime_PlansOneDoseReminderKeyedByTheReminderInstant()
    {
        var prescription = ByParts(MedicationA, ["morning", "night"], "morning=08:00,night=22:00");
        var now = At(8);

        var planned = Assert.Single(Plan(now, [Recipient()], [State(Statuses([prescription], now))]).Notifications);

        Assert.Equal($"dose:{prescription.Id:N}:202603021100", planned.BaseKey.Value);
        Assert.Equal((NotificationKind.DoseDue, NotificationUrgency.High, TimeSpan.FromMinutes(90)), (planned.Kind, planned.Urgency, planned.TimeToLive));
        Assert.Equal((At(8), new NotificationContent(BabyId, prescription.Id, At(8), null)), (planned.DueAt, planned.Content));
    }

    [Fact]
    public void Plan_RemindersOff_PlansNothing()
    {
        var prescription = ByParts(MedicationA, ["morning"]);
        var now = At(8);

        var plan = Plan(now, [Recipient()], [State(Statuses([prescription], now))]);

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_PartAlreadyGiven_PlansNothing()
    {
        var prescription = ByParts(MedicationA, ["morning"], "morning=08:00");
        var now = At(8);

        var plan = Plan(now, [Recipient()], [State(Statuses([prescription], now, Dose(At(7, 10), MedicationA)))]);

        Assert.Empty(plan.Notifications);
    }

    [Fact]
    public void Plan_BeforeTheReminderTime_PlansNothingYet()
    {
        var prescription = ByParts(MedicationA, ["morning"], "morning=08:00");
        var now = At(7, 59);

        Assert.Empty(Plan(now, [Recipient()], [State(Statuses([prescription], now))]).Notifications);
    }

    [Fact]
    public void Plan_LeadTime_NeverSendsBeforeTheWindowOpens()
    {
        var prescription = ByParts(MedicationA, ["morning"], "morning=05:05");

        var early = Plan(At(4, 55), [Recipient(doseLead: 15)], [State(Statuses([prescription], At(4, 55)))]);
        var opened = Assert.Single(Plan(At(5), [Recipient(doseLead: 15)], [State(Statuses([prescription], At(5)))]).Notifications);

        Assert.Empty(early.Notifications);
        Assert.Equal((At(5), At(5, 5)), (opened.DueAt, opened.Content.At));
    }

    [Fact]
    public void Plan_AlreadyDeliveredForThatPartAndDate_IsNotPlannedAgain()
    {
        var prescription = ByParts(MedicationA, ["morning"], "morning=08:00");
        var now = At(8, 10);
        var delivered = new DeliveredNotification(MomId, NotificationKey.ForDose(prescription.Id, At(8)));

        var plan = Plan(now, [Recipient()], [State(Statuses([prescription], now))], delivered: [delivered]);

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_NightReminderAfterMidnight_UsesTheNightOfTheDayBefore()
    {
        var prescription = ByParts(MedicationA, ["night"], "night=01:30");
        var now = At(1, 30, day: 3);

        var planned = Assert.Single(Plan(now, [Recipient()], [State(Statuses([prescription], now))]).Notifications);

        Assert.Equal($"dose:{prescription.Id:N}:202603030430", planned.BaseKey.Value);
    }

    [Fact]
    public void Plan_InQuietHours_MedicineReminderIsStillDeliveredUnlessSilenced()
    {
        var prescription = ByParts(MedicationA, ["night"], "night=22:30");
        var now = At(22, 30);
        var states = new[] { State(Statuses([prescription], now)) };

        var delivered = Plan(now, [Recipient()], states);
        var silenced = Plan(now, [Recipient(quietIncludesMedicine: true)], states);

        Assert.Single(delivered.Notifications);
        Assert.Equal([NotificationSkipReason.QuietHours], silenced.Skipped.Select(skipped => skipped.Reason));
    }

    [Fact]
    public void Plan_GroupIntervalPastTheWindowEnd_HoldsItBack()
    {
        var prescription = ByParts(MedicationA, ["morning"], "morning=11:00", group: "colic");
        var member = AsNeeded(MedicationB, 480, group: "colic");
        var now = At(11);

        var plan = Plan(now, [Recipient()], [State(Statuses([prescription, member], now, Dose(At(6), MedicationB)))]);

        Assert.Empty(plan.Notifications);
        Assert.Equal([NotificationSkipReason.Unavailable], plan.Skipped.Select(skipped => skipped.Reason));
    }

    [Fact]
    public void Plan_MedicineRemindersOffForTheRecipient_PlansNothing()
    {
        var prescription = ByParts(MedicationA, ["morning"], "morning=08:00");
        var now = At(8);

        Assert.Empty(Plan(now, [Recipient(doseDue: false, napWindow: true)], [State(Statuses([prescription], now))]).Notifications);
    }
}
