using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Lotties.Domain.Vaccinations;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;
using static Lotties.Domain.Tests.Vaccinations.VaccineScheduleFixtures;

namespace Lotties.Domain.Tests.Notifications;

/// <summary>
/// The <c>vaccine_due</c> rules of the planner (São Paulo, quiet hours 22:00-07:00 unless stated). The baby was born on
/// 2025-12-31, so a dose recommended at 61 days becomes due on 2026-03-02.
/// </summary>
public sealed class NotificationPlannerVaccineTests
{
    private static readonly DateOnly Birth = new(2025, 12, 31);

    private static readonly NotificationRecipient Mom = Recipient(doseDue: false, appointmentReminders: false, vaccineReminders: true);

    private static readonly VaccineSchedule TwoMonths = Schedule(
        Dose("penta-1", 61, "penta", alternativeGroup: "dtp-1", covers: ["hepb-2"]),
        Dose("hexa-1", 61, "hexa", network: VaccineNetwork.Private, alternativeGroup: "dtp-1", covers: ["vip-1"]),
        Dose("vip-1", 61, "vip"),
        Dose("hepb-2", 61, "hepb", network: VaccineNetwork.Private));

    private static VaccinePlanState Vaccines(VaccineSchedule? schedule = null, VaccineCoverage coverage = VaccineCoverage.Public, params VaccinationRecord[] records) =>
        new(schedule ?? Schedule(Dose("d-1", 61, "d")), VaccineProfile.Create(coverage, null, null), Birth, records);

    private static NotificationPlan PlanAt(DateTimeOffset now, VaccinePlanState? vaccines = null, NotificationRecipient? recipient = null, NotificationNameSource? names = null, params DeliveredNotification[] delivered) =>
        Plan(now, [recipient ?? Mom], [], delivered: delivered, names: names, vaccines: vaccines ?? Vaccines());

    private static NotificationKey KeyOf(string doseId, int number) => NotificationKey.ForVaccine(BabyId, doseId, null, number);

    [Fact]
    public void Plan_TheDayADoseBecomesDue_RemindsAtNineInTheMorning()
    {
        var early = PlanAt(At(8, 59));
        var planned = Assert.Single(PlanAt(At(9, 0)).Notifications);

        Assert.Empty(early.Notifications);
        Assert.Equal($"vaccine:{BabyId:N}:d-1:1", planned.BaseKey.Value);
        Assert.Equal((NotificationKind.VaccineDue, NotificationUrgency.Normal, At(9, 0), TimeSpan.FromHours(48)), (planned.Kind, planned.Urgency, planned.DueAt, planned.TimeToLive));
        Assert.Equal(new NotificationContent(BabyId, null, At(9, 0), null, VaccineDoseId: "d-1"), planned.Content);
        Assert.Equal("vaccine_due", NotificationCodes.Of(planned.Kind));
    }

    [Fact]
    public void Plan_FourteenDaysLaterStillNotGiven_SendsOneFollowUp()
    {
        var first = new DeliveredNotification(MomId, KeyOf("d-1", 1));

        var followUp = Assert.Single(PlanAt(At(9, 0, day: 16), delivered: first).Notifications);
        var given = PlanAt(At(9, 0, day: 16), Vaccines(records: new VaccinationRecord(Guid.NewGuid(), "d-1", new DateOnly(2026, 3, 10))), delivered: first);

        Assert.Equal(KeyOf("d-1", 2), followUp.BaseKey);
        Assert.Equal(At(9, 0, day: 16), followUp.DueAt);
        Assert.Empty(given.Notifications);
    }

    [Fact]
    public void Plan_AfterTheFollowUp_NothingMoreIsSent()
    {
        var plans = new[] { At(9, 0, day: 30), new DateTimeOffset(2026, 4, 1, 9, 0, 0, SaoPaulo), new DateTimeOffset(2026, 6, 1, 9, 0, 0, SaoPaulo) }
            .Select(now => PlanAt(now, delivered: [new DeliveredNotification(MomId, KeyOf("d-1", 1)), new DeliveredNotification(MomId, KeyOf("d-1", 2))]));

        Assert.All(plans, plan => Assert.Empty(plan.Notifications));
    }

    [Fact]
    public void Plan_SwitchTurnedOnLongAfterTheDueDay_SendsNothingOld()
    {
        var plan = PlanAt(At(9, 0, day: 10));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_YesterdaysReminderAfterDowntime_IsStale()
    {
        var plan = PlanAt(At(9, 30, day: 3));

        var skipped = Assert.Single(plan.Skipped);
        Assert.Equal((KeyOf("d-1", 1), NotificationSkipReason.Stale), (skipped.DedupeKey, skipped.Reason));
        Assert.Empty(plan.Notifications);
    }

    [Fact]
    public void Plan_CoveredByACombinedProduct_IsNotSent()
    {
        var records = new VaccinationRecord(Guid.NewGuid(), "hexa-1", new DateOnly(2026, 3, 1));

        var plan = PlanAt(At(9, 0), Vaccines(TwoMonths, VaccineCoverage.PublicAndPrivate, records));

        Assert.Equal([KeyOf("hepb-2", 1)], plan.Notifications.Select(planned => planned.BaseKey));
    }

    [Fact]
    public void Plan_AlternativesDueTheSameDay_RemindOncePerSlot()
    {
        var plan = PlanAt(At(9, 0), Vaccines(TwoMonths, VaccineCoverage.PublicAndPrivate));

        Assert.Equal([KeyOf("hepb-2", 1), KeyOf("penta-1", 1), KeyOf("vip-1", 1)], plan.Notifications.Select(planned => planned.BaseKey));
    }

    [Fact]
    public void Plan_PublicProfile_LeavesPrivateDosesOut()
    {
        var plan = PlanAt(At(9, 0), Vaccines(TwoMonths));

        Assert.Equal([KeyOf("penta-1", 1), KeyOf("vip-1", 1)], plan.Notifications.Select(planned => planned.BaseKey));
    }

    [Fact]
    public void Plan_QuietHoursUntilTen_DelaysToTheirEndTheSameDay()
    {
        var lateMorning = Recipient(doseDue: false, vaccineReminders: true, quietHours: QuietHours.Create(true, new TimeOnly(22, 0), new TimeOnly(10, 0)));

        var before = PlanAt(At(9, 30), recipient: lateMorning);
        var planned = Assert.Single(PlanAt(At(10, 0), recipient: lateMorning).Notifications);

        Assert.Empty(before.Notifications);
        Assert.Equal(At(10, 0), planned.DueAt);
    }

    [Fact]
    public void Plan_QuietHoursCoveringTheRestOfTheDay_SkipThatReminder()
    {
        var allDay = Recipient(doseDue: false, vaccineReminders: true, quietHours: QuietHours.Create(true, new TimeOnly(8, 0), new TimeOnly(7, 0)));

        var plans = new[] { At(9, 0), At(23, 0), At(7, 30, day: 3) }.Select(now => PlanAt(now, recipient: allDay));

        Assert.All(plans, plan => Assert.Empty(plan.Notifications));
    }

    [Theory]
    [InlineData(BabyRole.Owner, true)]
    [InlineData(BabyRole.Parent, true)]
    [InlineData(BabyRole.Caregiver, false)]
    [InlineData(BabyRole.Viewer, false)]
    [InlineData(BabyRole.Doctor, false)]
    public void Plan_OnlyOwnersAndParentsReceive(BabyRole role, bool receives)
    {
        var plan = PlanAt(At(9, 0), recipient: Recipient(role: role, doseDue: false, vaccineReminders: true));

        Assert.Equal(receives ? 1 : 0, plan.Notifications.Count);
    }

    [Fact]
    public void Plan_SwitchOffOrNothingLoaded_PlansNothing()
    {
        var off = Plan(At(9, 0), [Recipient(doseDue: false)], [], vaccines: Vaccines());
        var unloaded = Plan(At(9, 0), [Mom], []);

        Assert.Empty(off.Notifications);
        Assert.Empty(unloaded.Notifications);
    }

    [Fact]
    public void Plan_ShowNames_AddsTheBabyAndTheShortVaccineName()
    {
        var named = Recipient(doseDue: false, vaccineReminders: true, showNames: true);

        var planned = Assert.Single(PlanAt(At(9, 0), recipient: named, names: new NotificationNameSource("Lia", new Dictionary<Guid, string>())).Notifications);

        Assert.Equal("Lia", planned.Content.Names!.Baby);
        Assert.Equal(("d", "d pt"), (planned.Content.Names.Vaccine!.In("en"), planned.Content.Names.Vaccine.In("pt-BR")));
    }

    [Fact]
    public void Plan_YearlyDose_KeysTheOccurrenceByItsDueDay()
    {
        var yearly = Schedule(Dose("flu-yearly", 61, "flu", recurrence: new DoseRecurrence(365, 61)));

        var planned = Assert.Single(PlanAt(At(9, 0), Vaccines(yearly)).Notifications);

        Assert.Equal($"vaccine:{BabyId:N}:flu-yearly@20260302:1", planned.BaseKey.Value);
        Assert.True(planned.BaseKey.TryGetVaccine(out var doseId));
        Assert.Equal("flu-yearly", doseId);
    }

    [Fact]
    public void Key_DoseIdStartingWithS_IsNotASnoozeResend()
    {
        var key = NotificationKey.ForVaccine(BabyId, "sarampo-1", null, 1);

        Assert.False(key.IsSnoozeResend);
        Assert.Equal(key, key.Base);
        Assert.True(key.Snoozed(1).IsSnoozeResend);
        Assert.Equal(key, key.Snoozed(1).Base);
    }
}
