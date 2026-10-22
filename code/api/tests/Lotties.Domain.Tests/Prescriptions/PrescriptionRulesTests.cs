using Lotties.Domain.Exceptions;
using Lotties.Domain.Prescriptions;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Prescriptions;

public sealed class DoseRuleTests
{
    [Fact]
    public void Create_RoundsAmountToThreeDecimals()
    {
        var dose = DoseRule.Create(2.12345m, " ml ", perKg: false, roundingStep: null);

        Assert.Equal((2.123m, "ml"), (dose.Amount, dose.Unit));
    }

    [Theory]
    [InlineData(0, "drops", false, null, "dose.amount")]
    [InlineData(10_000_000, "drops", false, null, "dose.amount")]
    [InlineData(1, " ", false, null, "dose.unit")]
    [InlineData(1, "this unit is far too long", false, null, "dose.unit")]
    [InlineData(1, "drops", false, 1.0, "dose.roundingStep")]
    [InlineData(1, "drops", true, 0.0, "dose.roundingStep")]
    [InlineData(1, "drops", true, 1001.0, "dose.roundingStep")]
    public void Create_Invalid_ThrowsForTheField(double amount, string unit, bool perKg, double? step, string field)
    {
        var exception = Assert.Throws<DomainValidationException>(() => DoseRule.Create((decimal)amount, unit, perKg, (decimal?)step));

        Assert.Equal(field, exception.Field);
    }

    [Theory]
    [InlineData("sprays")]
    [InlineData("Jatos")]
    [InlineData("puff")]
    [InlineData("supositório")]
    [InlineData("applications")]
    [InlineData(" Aplicações ")]
    public void Create_PerKgInACountedUnit_ThrowsForPerKg(string unit)
    {
        var exception = Assert.Throws<DomainValidationException>(() => DoseRule.Create(1, unit, perKg: true, roundingStep: 1));

        Assert.Equal("dose.perKg", exception.Field);
    }

    [Theory]
    [InlineData(1.5, "sprays")]
    [InlineData(1.5, "puffs")]
    [InlineData(0.5, "jatos")]
    [InlineData(0.25, "suppository")]
    [InlineData(1.75, "supositórios")]
    public void Create_AmountOffTheCountedUnitStep_ThrowsForAmount(double amount, string unit)
    {
        var exception = Assert.Throws<DomainValidationException>(() => DoseRule.Create((decimal)amount, unit, perKg: false, roundingStep: null));

        Assert.Equal("dose.amount", exception.Field);
    }

    [Theory]
    [InlineData(0.5)]
    [InlineData(1)]
    [InlineData(1.5)]
    public void Create_HalfSuppositories_AreAllowed(double amount)
    {
        var dose = DoseRule.Create((decimal)amount, "supositório", perKg: false, roundingStep: null);

        Assert.Equal((decimal)amount, dose.Amount);
    }

    [Theory]
    [InlineData(2, "sprays")]
    [InlineData(1, "supositório")]
    [InlineData(2, "puffs")]
    [InlineData(0.5, "application")]
    [InlineData(1.5, "tablet")]
    public void Create_CountedUnitsAndOtherFreeText_AreKept(double amount, string unit)
    {
        var dose = DoseRule.Create((decimal)amount, unit, perKg: false, roundingStep: null);

        Assert.Equal(((decimal)amount, unit), (dose.Amount, dose.Unit));
    }

    [Fact]
    public void Create_PerKgInAMeasuredUnit_StillAllowed()
    {
        var dose = DoseRule.Create(0.5m, "gotas", perKg: true, roundingStep: 1);

        Assert.True(dose.PerKg);
    }

    [Fact]
    public void Create_UnitWithNul_Throws()
    {
        Assert.Throws<DomainValidationException>(() => DoseRule.Create(1, "dr\0ops", perKg: false, roundingStep: null));
    }

    [Fact]
    public void SuggestFor_PerKgWithStep_RoundsToNearestStepAndShowsInputs()
    {
        var rule = DoseRule.Create(1, "drops", perKg: true, roundingStep: 1);

        var suggestion = rule.SuggestFor(new BodyWeight(4.6m, new DateOnly(2026, 1, 1)), new DateOnly(2026, 1, 10));

        Assert.Equal(new SuggestedDose(5, 4.6m, "drops", 1, 4.6m, new DateOnly(2026, 1, 1), Stale: false, 1), suggestion);
    }

    [Theory]
    [InlineData(4.25, 0.5, 4.5)]
    [InlineData(4.24, 0.5, 4.0)]
    [InlineData(0.4, 1.0, 0.0)]
    public void SuggestFor_RoundsMidpointsAwayFromZero(double exact, double step, double expected)
    {
        var rule = DoseRule.Create(1, "mL", perKg: true, roundingStep: (decimal)step);

        var suggestion = rule.SuggestFor(new BodyWeight((decimal)exact, new DateOnly(2026, 1, 1)), new DateOnly(2026, 1, 1))!;

        Assert.Equal((decimal)expected, suggestion.Amount);
        Assert.Equal((decimal)exact, suggestion.ExactAmount);
    }

    [Fact]
    public void SuggestFor_NoStep_IsTheExactAmount()
    {
        var rule = DoseRule.Create(0.15m, "mL", perKg: true, roundingStep: null);

        var suggestion = rule.SuggestFor(new BodyWeight(5.55m, new DateOnly(2026, 1, 1)), new DateOnly(2026, 1, 1))!;

        Assert.Equal((0.833m, 0.833m), (suggestion.Amount, suggestion.ExactAmount));
    }

    [Theory]
    [InlineData(30, false)]
    [InlineData(31, true)]
    public void SuggestFor_WeightOlderThan30Days_IsStale(int ageDays, bool stale)
    {
        var today = new DateOnly(2026, 3, 1);
        var rule = DoseRule.Create(1, "drops", perKg: true, roundingStep: null);

        var suggestion = rule.SuggestFor(new BodyWeight(5, today.AddDays(-ageDays)), today)!;

        Assert.Equal(stale, suggestion.Stale);
    }

    [Fact]
    public void SuggestFor_NotPerKgOrNoWeight_IsNull()
    {
        var weight = new BodyWeight(5, new DateOnly(2026, 1, 1));

        Assert.Null(TwoDrops.SuggestFor(weight, new DateOnly(2026, 1, 1)));
        Assert.Null(DoseRule.Create(1, "drops", perKg: true, roundingStep: null).SuggestFor(null, new DateOnly(2026, 1, 1)));
    }
}

public sealed class PrescriptionScheduleTests
{
    [Fact]
    public void Create_AsNeeded_KeepsIntervalMaxAndIndication()
    {
        var schedule = PrescriptionSchedule.Create(PrescriptionKind.AsNeeded, null, null, 480, 3, " belly pain ");

        Assert.Equal((480, 3, "belly pain", TimeSpan.FromHours(8)), (schedule.MinIntervalMinutes!.Value, schedule.MaxDosesPer24h!.Value, schedule.Indication, schedule.OwnInterval!.Value));
    }

    [Fact]
    public void Create_ScheduledTimes_HasNoOwnInterval()
    {
        var schedule = PrescriptionSchedule.Create(PrescriptionKind.Scheduled, TimesOfDay.Parse(["08:00"]), null, null, null, null);

        Assert.Null(schedule.OwnInterval);
    }

    [Theory]
    [InlineData(PrescriptionKind.AsNeeded, null, null, null, null, "minIntervalMinutes")]
    [InlineData(PrescriptionKind.AsNeeded, null, null, 14, null, "minIntervalMinutes")]
    [InlineData(PrescriptionKind.AsNeeded, null, null, 10081, null, "minIntervalMinutes")]
    [InlineData(PrescriptionKind.AsNeeded, null, null, 480, 0, "maxDosesPer24h")]
    [InlineData(PrescriptionKind.AsNeeded, null, null, 480, 25, "maxDosesPer24h")]
    [InlineData(PrescriptionKind.AsNeeded, "08:00", null, 480, null, "timesOfDay")]
    [InlineData(PrescriptionKind.AsNeeded, null, 60, 480, null, "everyMinutes")]
    [InlineData(PrescriptionKind.Scheduled, null, null, null, null, "timesOfDay")]
    [InlineData(PrescriptionKind.Scheduled, "08:00", 60, null, null, "timesOfDay")]
    [InlineData(PrescriptionKind.Scheduled, null, 10, null, null, "everyMinutes")]
    [InlineData(PrescriptionKind.Scheduled, "08:00", null, 480, null, "minIntervalMinutes")]
    [InlineData(PrescriptionKind.Scheduled, "08:00", null, null, 3, "maxDosesPer24h")]
    public void Create_Invalid_ThrowsForTheField(PrescriptionKind kind, string? time, int? every, int? minInterval, int? maxDoses, string field)
    {
        var times = time is null ? null : TimesOfDay.Parse([time]);

        var exception = Assert.Throws<DomainValidationException>(() => PrescriptionSchedule.Create(kind, times, every, minInterval, maxDoses, null));

        Assert.Equal(field, exception.Field);
    }

    [Theory]
    [InlineData(15)]
    [InlineData(10080)]
    public void Create_IntervalBounds_AreAccepted(int minutes)
    {
        Assert.Equal(minutes, PrescriptionSchedule.Create(PrescriptionKind.AsNeeded, null, null, minutes, null, null).MinIntervalMinutes);
    }

    [Fact]
    public void Create_IndicationTooLong_Throws()
    {
        var exception = Assert.Throws<DomainValidationException>(() => PrescriptionSchedule.Create(PrescriptionKind.AsNeeded, null, null, 60, null, new string('x', 201)));

        Assert.Equal("indication", exception.Field);
    }

    [Fact]
    public void TimesOfDay_Parse_SortsAndComparesByValue()
    {
        var times = TimesOfDay.Parse(["20:00", "08:00"]);

        Assert.Equal(["08:00", "20:00"], times.ToStrings());
        Assert.Equal(TimesOfDay.Parse(["08:00", "20:00"]), times);
        Assert.Equal(TimesOfDay.Parse(["08:00", "20:00"]).GetHashCode(), times.GetHashCode());
    }

    [Theory]
    [InlineData("8:00")]
    [InlineData("24:00")]
    [InlineData("08:60")]
    [InlineData("08:00:00")]
    [InlineData("08:00\n")]
    [InlineData("")]
    public void TimesOfDay_Parse_Malformed_Throws(string text)
    {
        Assert.Equal("timesOfDay", Assert.Throws<DomainValidationException>(() => TimesOfDay.Parse([text])).Field);
    }

    [Fact]
    public void TimesOfDay_DuplicatesEmptyOrTooMany_Throw()
    {
        Assert.Throws<DomainValidationException>(() => TimesOfDay.Parse(["08:00", "08:00"]));
        Assert.Throws<DomainValidationException>(() => TimesOfDay.Parse([]));
        Assert.Throws<DomainValidationException>(() => TimesOfDay.Parse(Enumerable.Range(0, 25).Select(minute => $"00:{minute:00}").ToArray()));
    }

    [Fact]
    public void IntervalGroup_IsNormalisedAndOptional()
    {
        Assert.Equal(IntervalGroup.FromOptional("colica"), IntervalGroup.FromOptional("  Cólica "));
        Assert.Null(IntervalGroup.FromOptional("  "));
        Assert.Equal("intervalGroup", Assert.Throws<DomainValidationException>(() => IntervalGroup.FromOptional(new string('x', 51))).Field);
    }
}

public sealed class PrescriptionTests
{
    private static readonly Guid MedicationId = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 1, 10, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("2026-01-10", "2026-01-09", "endDate")]
    [InlineData("1999-12-31", null, "startDate")]
    [InlineData("2026-01-10", "2101-01-01", "endDate")]
    public void Terms_InvalidDates_Throw(string start, string? end, string field)
    {
        var exception = Assert.Throws<DomainValidationException>(() => Terms(MedicationId, AsNeededSchedule(), start: DateOnly.Parse(start), end: end is null ? null : DateOnly.Parse(end)));

        Assert.Equal(field, exception.Field);
    }

    [Fact]
    public void Terms_SameDayEnd_IsValid()
    {
        var terms = Terms(MedicationId, AsNeededSchedule(), start: new DateOnly(2026, 1, 10), end: new DateOnly(2026, 1, 10));

        Assert.Equal(terms.StartDate, terms.EndDate);
    }

    [Fact]
    public void Terms_TextLimits_Throw()
    {
        Assert.Equal("prescriber", Assert.Throws<DomainValidationException>(() =>
            PrescriptionTerms.Create(MedicationId, PrescriptionStatus.Active, TwoDrops, AsNeededSchedule(), null, new DateOnly(2026, 1, 1), null, new string('x', 101), null)).Field);
        Assert.Equal("instructions", Assert.Throws<DomainValidationException>(() =>
            PrescriptionTerms.Create(MedicationId, PrescriptionStatus.Active, TwoDrops, AsNeededSchedule(), null, new DateOnly(2026, 1, 1), null, null, "a\0b")).Field);
        Assert.Equal("medicationId", Assert.Throws<DomainValidationException>(() =>
            PrescriptionTerms.Create(Guid.Empty, PrescriptionStatus.Active, TwoDrops, AsNeededSchedule(), null, new DateOnly(2026, 1, 1), null, null, null)).Field);
    }

    [Fact]
    public void Edit_SameTerms_ChangesNothing()
    {
        var prescription = Prescription.Create(Guid.NewGuid(), BabyId, Terms(MedicationId, AsNeededSchedule()), UserId, Now);

        prescription.Edit(Terms(MedicationId, AsNeededSchedule()), Now.AddHours(1), Now.AddHours(1));

        Assert.Equal((Now, Now), (prescription.UpdatedAt, prescription.ClientUpdatedAt));
    }

    [Fact]
    public void Edit_ChangedTerms_AppliesAndStampsTimes()
    {
        var prescription = Prescription.Create(Guid.NewGuid(), BabyId, Terms(MedicationId, AsNeededSchedule()), UserId, Now);

        prescription.Edit(Terms(MedicationId, AsNeededSchedule(), group: "colic"), Now.AddHours(1), Now.AddMinutes(30));

        Assert.Equal(("colic", Now.AddHours(1), Now.AddMinutes(30)), (prescription.IntervalGroup!.Value.Value, prescription.UpdatedAt, prescription.ClientUpdatedAt));
    }

    [Fact]
    public void DecideUpsert_StaleClientTime_IsIgnored()
    {
        var prescription = Prescription.Create(Guid.NewGuid(), BabyId, Terms(MedicationId, AsNeededSchedule()), UserId, Now, Now);

        Assert.Equal(PrescriptionUpsertDecision.IgnoreStale, prescription.DecideUpsert(BabyId, Now.AddSeconds(-1), Now));
        Assert.Equal(PrescriptionUpsertDecision.Apply, prescription.DecideUpsert(BabyId, Now, Now));
        Assert.Equal(PrescriptionUpsertDecision.Apply, prescription.DecideUpsert(BabyId, null, Now));
    }

    [Fact]
    public void DecideUpsert_OtherBaby_Throws()
    {
        var prescription = Prescription.Create(Guid.NewGuid(), BabyId, Terms(MedicationId, AsNeededSchedule()), UserId, Now);

        Assert.Throws<PrescriptionBabyMismatchException>(() => prescription.DecideUpsert(Guid.NewGuid(), null, Now));
    }

    [Fact]
    public void SoftDelete_IsIdempotentAndBlocksEdits()
    {
        var prescription = Prescription.Create(Guid.NewGuid(), BabyId, Terms(MedicationId, AsNeededSchedule()), UserId, Now);

        prescription.SoftDelete(Now.AddHours(1));
        prescription.SoftDelete(Now.AddHours(2));

        Assert.Equal((Now.AddHours(1), Now.AddHours(1)), (prescription.DeletedAt!.Value, prescription.UpdatedAt));
        Assert.False(prescription.IsActive);
        Assert.Equal(PrescriptionUpsertDecision.IgnoreDeleted, prescription.DecideUpsert(BabyId, null, Now));
        Assert.Throws<PrescriptionDeletedException>(() => prescription.Edit(Terms(MedicationId, AsNeededSchedule(), group: "x"), Now));
    }

    [Fact]
    public void ClientTimeFarAhead_IsClampedToServerTime()
    {
        var prescription = Prescription.Create(Guid.NewGuid(), BabyId, Terms(MedicationId, AsNeededSchedule()), UserId, Now, Now.AddHours(1));

        Assert.Equal(Now, prescription.ClientUpdatedAt);
    }

    private static PrescriptionSchedule AsNeededSchedule() => PrescriptionSchedule.Create(PrescriptionKind.AsNeeded, null, null, 480, null, null);
}
