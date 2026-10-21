using BabyRoutine.Domain.Prescriptions;
using static BabyRoutine.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace BabyRoutine.Domain.Tests.Prescriptions;

public sealed class MedicationStatusCalculatorTests
{
    private const int SaoPaulo = -180;
    private static readonly Guid MedicationA = Guid.NewGuid();
    private static readonly Guid MedicationB = Guid.NewGuid();

    [Fact]
    public void OwnerExample_AsNeededEvery8hSharedGroup_DoseOfOneBlocksBothUntil18()
    {
        var x = AsNeeded(MedicationA, 480, group: "colic");
        var z = AsNeeded(MedicationB, 480, group: " Colic ");
        var given = Local(2026, 3, 2, 10, 0, SaoPaulo);

        var statuses = Calculate([x, z], [Dose(given, MedicationA, x.Id)], Local(2026, 3, 2, 12, 0, SaoPaulo), SaoPaulo);

        Assert.All(statuses, status => Assert.Equal(Local(2026, 3, 2, 18, 0, SaoPaulo), status.AvailableAt));
        Assert.All(statuses, status => Assert.False(status.AvailableNow));
        Assert.Equal([z.Id], statuses.Single(status => status.Prescription.Id == x.Id).GroupMemberIds);
        Assert.Equal(1, statuses.Single(status => status.Prescription.Id == x.Id).DosesLast24h);
        Assert.Equal(0, statuses.Single(status => status.Prescription.Id == z.Id).DosesLast24h);
    }

    [Fact]
    public void AsNeeded_AfterInterval_IsAvailableAgain()
    {
        var prescription = AsNeeded(MedicationA, 480);
        var given = Local(2026, 3, 2, 10, 0, SaoPaulo);

        var status = Calculate([prescription], [Dose(given, MedicationA)], Local(2026, 3, 2, 18, 0, SaoPaulo), SaoPaulo).Single();

        Assert.True(status.AvailableNow);
        Assert.Equal(given, status.LastDoseAt);
        Assert.Null(status.NextScheduledAt);
        Assert.Null(status.OverdueBy);
    }

    [Fact]
    public void AsNeeded_NoDoses_IsAvailableWithoutTimes()
    {
        var status = Calculate([AsNeeded(MedicationA, 480)], [], Local(2026, 3, 2, 12, 0, SaoPaulo), SaoPaulo).Single();

        Assert.Equal((true, (DateTimeOffset?)null, (DateTimeOffset?)null, 0), (status.AvailableNow, status.AvailableAt, status.LastDoseAt, status.DosesLast24h));
    }

    [Fact]
    public void MaxPer24h_Reached_WaitsForTheOldestCountedDoseToLeaveTheWindow()
    {
        var now = new DateTimeOffset(2026, 3, 2, 12, 0, 0, TimeSpan.Zero);
        var prescription = AsNeeded(MedicationA, 240, maxDoses: 3);
        var doses = new[] { Dose(now.AddHours(-20), MedicationA), Dose(now.AddHours(-12), MedicationA), Dose(now.AddHours(-5), MedicationA), Dose(now.AddHours(-30), MedicationA) };

        var status = Calculate([prescription], doses, now).Single();

        Assert.Equal((3, true, false), (status.DosesLast24h, status.LimitReached, status.AvailableNow));
        Assert.Equal(now.AddHours(4), status.AvailableAt);
    }

    [Fact]
    public void MaxPer24h_BelowLimit_UsesTheInterval()
    {
        var now = new DateTimeOffset(2026, 3, 2, 12, 0, 0, TimeSpan.Zero);
        var prescription = AsNeeded(MedicationA, 240, maxDoses: 3);

        var status = Calculate([prescription], [Dose(now.AddHours(-5), MedicationA), Dose(now.AddHours(-2), MedicationA)], now).Single();

        Assert.Equal((2, false, now.AddHours(2)), (status.DosesLast24h, status.LimitReached, status.AvailableAt!.Value));
    }

    [Fact]
    public void OwnerExample_ScheduledMorning_DueThenOverdueThenTaken()
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);

        var before = Calculate([prescription], [], Local(2026, 3, 2, 7, 0, SaoPaulo), SaoPaulo).Single();
        var late = Calculate([prescription], [], Local(2026, 3, 2, 9, 0, SaoPaulo), SaoPaulo).Single();
        var taken = Calculate([prescription], [Dose(Local(2026, 3, 2, 7, 45, SaoPaulo), MedicationA)], Local(2026, 3, 2, 9, 0, SaoPaulo), SaoPaulo).Single();

        Assert.Equal((Local(2026, 3, 2, 8, 0, SaoPaulo), (TimeSpan?)null), (before.NextScheduledAt!.Value, before.OverdueBy));
        Assert.Equal((Local(2026, 3, 3, 8, 0, SaoPaulo), TimeSpan.FromHours(1)), (late.NextScheduledAt!.Value, late.OverdueBy!.Value));
        Assert.Equal((Local(2026, 3, 3, 8, 0, SaoPaulo), (TimeSpan?)null), (taken.NextScheduledAt!.Value, taken.OverdueBy));
        Assert.True(taken.AvailableNow);
    }

    [Fact]
    public void Scheduled_DoseOutsideTheWindow_DoesNotTakeTheSlot()
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);

        var status = Calculate([prescription], [Dose(Local(2026, 3, 2, 9, 31, SaoPaulo), MedicationA)], Local(2026, 3, 2, 10, 0, SaoPaulo), SaoPaulo).Single();

        Assert.Equal(TimeSpan.FromHours(2), status.OverdueBy);
    }

    [Fact]
    public void Scheduled_OneDoseTakesOnlyOneSlot()
    {
        var prescription = AtTimes(MedicationA, ["08:00", "09:00"]);

        var status = Calculate([prescription], [Dose(Local(2026, 3, 2, 8, 30, 0), MedicationA)], Local(2026, 3, 2, 9, 30, 0)).Single();

        Assert.Equal(TimeSpan.FromMinutes(30), status.OverdueBy);
    }

    [Fact]
    public void Scheduled_TwoMissedSlots_OverdueCountsFromTheLatest()
    {
        var prescription = AtTimes(MedicationA, ["08:00", "20:00"]);

        var status = Calculate([prescription], [], Local(2026, 3, 2, 21, 0, 0), 0).Single();

        Assert.Equal((TimeSpan.FromHours(1), Local(2026, 3, 3, 8, 0, 0)), (status.OverdueBy!.Value, status.NextScheduledAt!.Value));
    }

    [Fact]
    public void Midnight_DoseAfterMidnightTakesYesterdaysLateSlot()
    {
        var prescription = AtTimes(MedicationA, ["23:30"]);

        var status = Calculate([prescription], [Dose(Local(2026, 3, 3, 0, 30, 0), MedicationA)], Local(2026, 3, 3, 0, 45, 0)).Single();

        Assert.Null(status.OverdueBy);
        Assert.Equal(Local(2026, 3, 3, 23, 30, 0), status.NextScheduledAt);
    }

    [Fact]
    public void Midnight_YesterdaysSlotIsOverdueOnlyWithinTheMatchWindow()
    {
        var prescription = AtTimes(MedicationA, ["23:30"]);

        var shortlyAfter = Calculate([prescription], [], Local(2026, 3, 3, 0, 45, 0)).Single();
        var later = Calculate([prescription], [], Local(2026, 3, 3, 1, 30, 0)).Single();

        Assert.Equal(TimeSpan.FromMinutes(75), shortlyAfter.OverdueBy);
        Assert.Null(later.OverdueBy);
    }

    [Fact]
    public void Midnight_DoseBeforeMidnightTakesTodaysEarlySlot()
    {
        var prescription = AtTimes(MedicationA, ["00:15"]);

        var status = Calculate([prescription], [Dose(Local(2026, 3, 2, 23, 50, 0), MedicationA)], Local(2026, 3, 3, 0, 30, 0)).Single();

        Assert.Null(status.OverdueBy);
        Assert.Equal(Local(2026, 3, 4, 0, 15, 0), status.NextScheduledAt);
    }

    [Theory]
    [InlineData(-720)]
    [InlineData(-180)]
    [InlineData(0)]
    [InlineData(330)]
    [InlineData(345)]
    [InlineData(840)]
    public void Property_LocalTimesOfDayFollowTheOffset(int offsetMinutes)
    {
        var prescription = AtTimes(MedicationA, ["08:00", "20:00"]);
        for (var hour = 0; hour < 24; hour++)
        {
            var now = Local(2026, 3, 2, hour, 10, offsetMinutes);
            var status = Calculate([prescription], [], now, offsetMinutes).Single();

            Assert.Equal(TimeSpan.FromMinutes(offsetMinutes), status.NextScheduledAt!.Value.ToOffset(TimeSpan.FromMinutes(offsetMinutes)).Offset);
            Assert.Contains(status.NextScheduledAt.Value.ToOffset(TimeSpan.FromMinutes(offsetMinutes)).TimeOfDay, new[] { TimeSpan.FromHours(8), TimeSpan.FromHours(20) });
            Assert.True(status.NextScheduledAt > now && status.NextScheduledAt - now <= TimeSpan.FromHours(12));
            Assert.Equal(hour is >= 8 and < 20 ? TimeSpan.FromHours(hour - 8).Add(TimeSpan.FromMinutes(10)) : hour >= 20 ? TimeSpan.FromHours(hour - 20).Add(TimeSpan.FromMinutes(10)) : null, status.OverdueBy);
        }
    }

    [Theory]
    [InlineData(-180)]
    [InlineData(0)]
    [InlineData(540)]
    public void Property_DoseNearASlotAlwaysTakesIt(int offsetMinutes)
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);
        for (var gap = -90; gap <= 90; gap += 15)
        {
            var given = Local(2026, 3, 2, 8, 0, offsetMinutes).AddMinutes(gap);
            var status = Calculate([prescription], [Dose(given, MedicationA)], Local(2026, 3, 2, 10, 0, offsetMinutes), offsetMinutes).Single();

            Assert.Null(status.OverdueBy);
            Assert.Equal(Local(2026, 3, 3, 8, 0, offsetMinutes), status.NextScheduledAt);
        }
    }

    [Fact]
    public void Scheduled_SlotsBeforeThePrescriptionWasCreated_AreNeverOverdue()
    {
        var prescription = AtTimes(MedicationA, ["08:00"], createdAt: Local(2026, 3, 2, 15, 0, 0));

        var status = Calculate([prescription], [], Local(2026, 3, 2, 16, 0, 0)).Single();

        Assert.Null(status.OverdueBy);
    }

    [Fact]
    public void Scheduled_DoseNamingAnotherPrescriptionOfTheSameMedication_CountsForTheIntervalNotTheSlot()
    {
        var scheduled = AtTimes(MedicationA, ["08:00"]);
        var asNeeded = AsNeeded(MedicationA, 360);

        var statuses = Calculate([scheduled, asNeeded], [Dose(Local(2026, 3, 2, 8, 0, 0), MedicationA, asNeeded.Id)], Local(2026, 3, 2, 9, 0, 0));

        var scheduledStatus = statuses.Single(status => status.Prescription.Id == scheduled.Id);
        Assert.Equal(TimeSpan.FromHours(1), scheduledStatus.OverdueBy);
        Assert.Equal(1, scheduledStatus.DosesLast24h);
        Assert.Equal(Local(2026, 3, 2, 14, 0, 0), statuses.Single(status => status.Prescription.Id == asNeeded.Id).AvailableAt);
    }

    [Fact]
    public void Group_TimesOfDayMemberUsesTheSmallestIntervalOfTheOtherMembers()
    {
        var scheduled = AtTimes(MedicationA, ["08:00"], group: "colic");
        var asNeeded = AsNeeded(MedicationB, 480, group: "colic");

        var statuses = Calculate([scheduled, asNeeded], [Dose(Local(2026, 3, 2, 7, 0, 0), MedicationB)], Local(2026, 3, 2, 9, 0, 0));

        var scheduledStatus = statuses.Single(status => status.Prescription.Id == scheduled.Id);
        Assert.Equal((Local(2026, 3, 2, 15, 0, 0), false), (scheduledStatus.AvailableAt!.Value, scheduledStatus.AvailableNow));
        Assert.Equal(TimeSpan.FromHours(1), scheduledStatus.OverdueBy);
    }

    [Fact]
    public void Every_NextIsLastDosePlusPeriodAndOverdueWhenPast()
    {
        var now = new DateTimeOffset(2026, 3, 2, 12, 0, 0, TimeSpan.Zero);

        var status = Calculate([Every(MedicationA, 360)], [Dose(now.AddHours(-7), MedicationA)], now).Single();

        Assert.Equal((now.AddHours(-1), TimeSpan.FromHours(1), true), (status.NextScheduledAt!.Value, status.OverdueBy!.Value, status.AvailableNow));
    }

    [Fact]
    public void Every_BeforeTheFirstDose_HasNoScheduledTime()
    {
        var status = Calculate([Every(MedicationA, 360)], [], new DateTimeOffset(2026, 3, 2, 12, 0, 0, TimeSpan.Zero)).Single();

        Assert.Equal(((DateTimeOffset?)null, (TimeSpan?)null, true), (status.NextScheduledAt, status.OverdueBy, status.AvailableNow));
    }

    [Fact]
    public void Course_EndDate_IsTheLastLocalDay()
    {
        var prescription = AsNeeded(MedicationA, 60, start: new DateOnly(2026, 3, 1), end: new DateOnly(2026, 3, 1));

        var now = new DateTimeOffset(2026, 3, 2, 2, 0, 0, TimeSpan.Zero);

        var stillOnLocally = Calculate([prescription], [], now, SaoPaulo).Single();
        var endedLocally = Calculate([prescription], [], now, 0).Single();

        Assert.Equal((false, true), (stillOnLocally.CourseEnded, stillOnLocally.AvailableNow));
        Assert.Equal((true, false), (endedLocally.CourseEnded, endedLocally.AvailableNow));
    }

    [Fact]
    public void Course_NotStarted_IsNotAvailableAndSchedulesFromTheStartDate()
    {
        var prescription = AtTimes(MedicationA, ["08:00"], start: new DateOnly(2026, 3, 3));

        var status = Calculate([prescription], [], Local(2026, 3, 2, 12, 0, 0)).Single();

        Assert.Equal((false, false, false), (status.CourseStarted, status.CourseEnded, status.AvailableNow));
        Assert.Equal(Local(2026, 3, 3, 8, 0, 0), status.NextScheduledAt);
        Assert.Null(status.OverdueBy);
    }

    [Fact]
    public void OwnerExample_PerKg_SuggestsFromTheLatestWeight()
    {
        var prescription = AsNeeded(MedicationA, 480, dose: DoseRule.Create(1, "drops", perKg: true, roundingStep: 1));

        var status = Calculate([prescription], [], Local(2026, 3, 2, 12, 0, 0), weight: new BodyWeight(4.6m, new DateOnly(2026, 2, 20))).Single();

        Assert.Equal(new SuggestedDose(5, 4.6m, "drops", 1, 4.6m, new DateOnly(2026, 2, 20), Stale: false, 1), status.SuggestedDose);
    }

    [Fact]
    public void StoppedAndDeletedPrescriptions_HaveNoStatus()
    {
        var stopped = Create(Terms(MedicationA, PrescriptionSchedule.Create(PrescriptionKind.AsNeeded, null, null, 60, null, null), status: PrescriptionStatus.Stopped));
        var deleted = AsNeeded(MedicationA, 60);
        deleted.SoftDelete(new DateTimeOffset(2026, 1, 2, 0, 0, 0, TimeSpan.Zero));

        Assert.Empty(Calculate([stopped, deleted], [], new DateTimeOffset(2026, 3, 2, 12, 0, 0, TimeSpan.Zero)));
    }

    [Fact]
    public void Calculate_OffsetBeyond14Hours_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Calculate([], [], new DateTimeOffset(2026, 3, 2, 12, 0, 0, TimeSpan.Zero), 15 * 60));
    }
}
