using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Lotties.Domain.Prescriptions;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Notifications;

public sealed class NotificationPlannerDoseTests
{
    private static readonly Guid MedicationA = Guid.NewGuid();
    private static readonly Guid MedicationB = Guid.NewGuid();

    [Fact]
    public void Plan_AtSlotTime_PlansOneHighUrgencyReminderKeyedBySlot()
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);
        var now = At(8);

        var plan = Plan(now, [Recipient()], [State(Statuses([prescription], now))]);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal($"dose:{prescription.Id:N}:202603021100", planned.BaseKey.Value);
        Assert.Equal(planned.BaseKey, planned.DedupeKey);
        Assert.Equal((MomId, NotificationKind.DoseDue, (Guid?)BabyId), (planned.UserId, planned.Kind, planned.BabyId));
        Assert.Equal((At(8), TimeSpan.FromMinutes(90), NotificationUrgency.High), (planned.DueAt, planned.TimeToLive, planned.Urgency));
        Assert.Equal(new NotificationContent(BabyId, prescription.Id, At(8), null), planned.Content);
        Assert.False(planned.IsResend);
        Assert.Empty(plan.Skipped);
    }

    [Theory]
    [InlineData(0, 7, 59, false)]
    [InlineData(0, 8, 0, true)]
    [InlineData(5, 7, 54, false)]
    [InlineData(5, 7, 55, true)]
    [InlineData(15, 7, 44, false)]
    [InlineData(15, 7, 45, true)]
    public void Plan_LeadTime_SendsFromSlotMinusLead(int lead, int hour, int minute, bool expected)
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);
        var now = At(hour, minute);

        var plan = Plan(now, [Recipient(doseLead: lead)], [State(Statuses([prescription], now))]);

        Assert.Equal(expected, plan.Notifications.Count == 1);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_EarlyReminder_DueAtSendTimeButShowsTheSlot()
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);
        var now = At(7, 50);

        var planned = Assert.Single(Plan(now, [Recipient(doseLead: 15)], [State(Statuses([prescription], now))]).Notifications);

        Assert.Equal((At(7, 45), At(8)), (planned.DueAt, planned.Content.At));
    }

    [Theory]
    [InlineData(30, true)]
    [InlineData(31, false)]
    public void Plan_StaleCutoff_DropsRemindersOlderThan30Minutes(int minutesLate, bool planned)
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);
        var now = At(8).AddMinutes(minutesLate);

        var plan = Plan(now, [Recipient()], [State(Statuses([prescription], now))]);

        var expectedSkips = planned ? Array.Empty<NotificationSkipReason>() : [NotificationSkipReason.Stale];

        Assert.Equal(planned, plan.Notifications.Count == 1);
        Assert.Equal(expectedSkips, plan.Skipped.Select(skipped => skipped.Reason));
    }

    [Fact]
    public void Plan_OpenEarlierSlot_DoesNotHideTheNextSlot()
    {
        var prescription = AtTimes(MedicationA, ["08:00", "09:00"]);
        var now = At(8, 50);
        var statuses = Statuses([prescription], now);

        var plan = Plan(now, [Recipient(doseLead: 15)], [State(statuses)]);

        Assert.Equal(At(8), statuses.Single().OverdueSlotAt);
        var planned = Assert.Single(plan.Notifications);
        Assert.Equal(NotificationKey.ForDose(prescription.Id, At(9)), planned.BaseKey);
        var skipped = Assert.Single(plan.Skipped);
        Assert.Equal((NotificationKey.ForDose(prescription.Id, At(8)), NotificationSkipReason.Stale), (skipped.DedupeKey, skipped.Reason));
    }

    [Fact]
    public void Plan_AlreadyDeliveredToTheUser_PlansNothing()
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);
        var now = At(8, 1);
        var delivered = new DeliveredNotification(MomId, NotificationKey.ForDose(prescription.Id, At(8)));

        var plan = Plan(now, [Recipient()], [State(Statuses([prescription], now))], delivered: [delivered]);

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_CoParents_EachGetTheirOwnReminder()
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);
        var now = At(8, 1);
        var delivered = new DeliveredNotification(MomId, NotificationKey.ForDose(prescription.Id, At(8)));

        var plan = Plan(now, [Recipient(MomId), Recipient(DadId, role: BabyRole.Owner)], [State(Statuses([prescription], now))], delivered: [delivered]);

        Assert.Equal([DadId], plan.Notifications.Select(planned => planned.UserId));
    }

    [Fact]
    public void Plan_DoseLoggedForTheSlot_ClosesIt()
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);
        var now = At(8, 10);

        var plan = Plan(now, [Recipient()], [State(Statuses([prescription], now, Dose(At(8, 5), MedicationA, prescription.Id)))]);

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_AsNeededPrescription_NeverReminded()
    {
        var prescription = AsNeeded(MedicationA, 240);
        var now = At(8);

        var plan = Plan(now, [Recipient()], [State(Statuses([prescription], now, Dose(At(3), MedicationA)))]);

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_CourseNotStartedEndedOrStopped_NoReminders()
    {
        var notStarted = AtTimes(MedicationA, ["08:00"], start: new DateOnly(2026, 3, 3));
        var ended = AtTimes(MedicationA, ["08:00"], end: new DateOnly(2026, 3, 1));
        var stopped = Create(Terms(MedicationB, PrescriptionSchedule.Create(PrescriptionKind.Scheduled, TimesOfDay.Parse(["08:00"]), null, null, null, null), status: PrescriptionStatus.Stopped));
        var now = At(8);

        var plan = Plan(now, [Recipient()], [State(Statuses([notStarted, ended, stopped], now))]);

        Assert.Empty(plan.Notifications);
    }

    [Fact]
    public void Plan_EveryNMinutesOverdue_PlansTheSlotOnce()
    {
        var prescription = Every(MedicationA, 240);
        var now = At(8, 5);
        var statuses = Statuses([prescription], now, Dose(At(4), MedicationA, prescription.Id));

        var plan = Plan(now, [Recipient()], [State(statuses)]);

        Assert.Equal((At(8), At(8)), (statuses.Single().OverdueSlotAt!.Value, statuses.Single().NextScheduledAt!.Value));
        Assert.Equal([NotificationKey.ForDose(prescription.Id, At(8))], plan.Notifications.Select(planned => planned.BaseKey));
    }

    [Fact]
    public void Plan_GroupDelaysAvailabilityWithinTheWindow_DueWhenAvailable()
    {
        var scheduled = AtTimes(MedicationA, ["08:00"], group: "fever");
        var asNeeded = AsNeeded(MedicationB, 480, group: "fever");
        var dose = Dose(At(0, 30), MedicationB, asNeeded.Id);

        var atSlot = Plan(At(8), [Recipient()], [State(Statuses([scheduled, asNeeded], At(8), dose))]);
        var whenAvailable = Plan(At(8, 30), [Recipient()], [State(Statuses([scheduled, asNeeded], At(8, 30), dose))]);

        Assert.Empty(atSlot.Notifications);
        var planned = Assert.Single(whenAvailable.Notifications);
        Assert.Equal((At(8, 30), At(8)), (planned.DueAt, planned.Content.At));
        Assert.Equal(NotificationKey.ForDose(scheduled.Id, At(8)), planned.BaseKey);
    }

    [Fact]
    public void Plan_GroupDelaysAvailabilityPastTheWindow_SkippedAsUnavailable()
    {
        var scheduled = AtTimes(MedicationA, ["08:00"], group: "fever");
        var asNeeded = AsNeeded(MedicationB, 480, group: "fever");
        var now = At(8);

        var plan = Plan(now, [Recipient()], [State(Statuses([scheduled, asNeeded], now, Dose(At(2), MedicationB, asNeeded.Id)))]);

        Assert.Empty(plan.Notifications);
        Assert.Equal([NotificationSkipReason.Unavailable], plan.Skipped.Select(skipped => skipped.Reason));
    }

    [Fact]
    public void Plan_QuietHours_MedicineStillDeliveredByDefault()
    {
        var prescription = AtTimes(MedicationA, ["23:00"]);
        var now = At(23);
        var state = State(Statuses([prescription], now));

        var delivered = Plan(now, [Recipient()], [state]);
        var silenced = Plan(now, [Recipient(quietIncludesMedicine: true)], [state]);

        Assert.Single(delivered.Notifications);
        Assert.Empty(silenced.Notifications);
        Assert.Equal([NotificationSkipReason.QuietHours], silenced.Skipped.Select(skipped => skipped.Reason));
    }

    [Fact]
    public void Plan_QuietHoursAcrossMidnight_EvaluatedInTheRecipientOffset()
    {
        var prescription = AtTimes(MedicationA, ["06:30"]);
        var now = At(6, 30);
        var state = State(Statuses([prescription], now));
        var quietUntilSeven = Recipient(quietIncludesMedicine: true);
        var quietUntilSix = Recipient(DadId, quietHours: QuietHours.Create(true, new TimeOnly(22, 0), new TimeOnly(6, 0)), quietIncludesMedicine: true);

        var plan = Plan(now, [quietUntilSeven, quietUntilSix], [state]);

        Assert.Equal([DadId], plan.Notifications.Select(planned => planned.UserId));
        Assert.Equal([(MomId, NotificationSkipReason.QuietHours)], plan.Skipped.Select(skipped => (skipped.UserId, skipped.Reason)));
    }

    [Fact]
    public void Plan_KindDisabled_PlansNothing()
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);
        var now = At(8);

        var plan = Plan(now, [Recipient(doseDue: false, napWindow: true)], [State(Statuses([prescription], now))]);

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_ViewerOrNoTimeZoneOrNoStateForTheOffset_PlansNothing()
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);
        var now = At(8);
        var recipients = new[]
        {
            Recipient(role: BabyRole.Viewer),
            Recipient(DadId, withoutZone: true),
            Recipient(Guid.NewGuid(), offset: TimeSpan.FromHours(1)),
        };

        var plan = Plan(now, recipients, [State(Statuses([prescription], now))]);

        Assert.Empty(plan.Notifications);
    }

    [Fact]
    public void Plan_ShowNamesOn_AddsTrimmedNamesOnlyForThatRecipient()
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);
        var now = At(8);
        var names = new NotificationNameSource(" Lia ", new Dictionary<Guid, string> { [MedicationA] = new string('x', 50) });

        var plan = Plan(now, [Recipient(MomId, showNames: true), Recipient(DadId)], [State(Statuses([prescription], now))], names: names);

        var withNames = plan.Notifications.Single(planned => planned.UserId == MomId).Content.Names!;
        Assert.Equal(("Lia", new string('x', 40)), (withNames.Baby, withNames.Medication));
        Assert.Null(plan.Notifications.Single(planned => planned.UserId == DadId).Content.Names);
    }

    [Fact]
    public void Plan_RecipientsInDifferentZones_UseTheirOwnLocalSlots()
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);
        var lisbon = TimeSpan.Zero;
        var now = new DateTimeOffset(2026, 3, 2, 8, 0, 0, lisbon);
        var states = new[]
        {
            State(Statuses([prescription], now)),
            State(Calculate([prescription], [], now, 0), offset: lisbon),
        };

        var plan = Plan(now, [Recipient(MomId), Recipient(DadId, offset: lisbon)], states);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal((DadId, now), (planned.UserId, planned.Content.At));
    }
}
