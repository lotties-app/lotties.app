using Lotties.Domain.Babies;
using Lotties.Domain.Clinical;
using Lotties.Domain.Events;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Tests.Vaccinations;
using Lotties.Domain.Vaccinations;
using static Lotties.Domain.Tests.Clinical.ClinicalFixtures;

namespace Lotties.Domain.Tests.Clinical;

public sealed class PauseMathTests
{
    private const long Hour = 3_600_000;

    [Fact]
    public void EffectiveSeconds_FinishedEvent_IsWallMinusFinishedPauses()
    {
        Assert.Equal(3600 - 600, PauseMath.EffectiveSeconds(0, Hour, pausedSeconds: 600, pausedAtMs: null, nowMs: 5 * Hour));
    }

    [Fact]
    public void EffectiveSeconds_FinishedEventIgnoresAStrayOpenPause()
    {
        Assert.Equal(3600, PauseMath.EffectiveSeconds(0, Hour, 0, pausedAtMs: Hour / 2, nowMs: 5 * Hour));
    }

    [Fact]
    public void EffectiveSeconds_RunningEvent_RemovesTheOpenPauseSoFar()
    {
        Assert.Equal(2 * 3600 - 300 - 1800, PauseMath.EffectiveSeconds(0, null, pausedSeconds: 300, pausedAtMs: Hour + (Hour / 2), nowMs: 2 * Hour));
    }

    [Fact]
    public void EffectiveSeconds_PausesLongerThanTheEvent_NeverGoBelowZero()
    {
        Assert.Equal(0, PauseMath.EffectiveSeconds(0, 60_000, pausedSeconds: 3600, pausedAtMs: null, nowMs: Hour));
    }

    [Fact]
    public void EffectiveSeconds_EndBeforeStart_IsZero()
    {
        Assert.Equal(0, PauseMath.EffectiveSeconds(Hour, 0, 0, null, Hour));
    }

    [Fact]
    public void EffectiveSeconds_WholeSeconds_TheFractionIsDropped()
    {
        Assert.Equal(1, PauseMath.EffectiveSeconds(0, 1999, 0, null, Hour));
    }

    [Fact]
    public void EffectiveMsInWindow_ClippedAndSpreadEvenlyOverTheEvent()
    {
        // 10 h event, 1 h paused: 9 h effective; the window holds 4 of its 10 wall hours -> 3.6 h.
        var ms = PauseMath.EffectiveMsInWindow(0, 10 * Hour, pausedSeconds: 3600, pausedAtMs: null, fromMs: 6 * Hour, toMs: 20 * Hour, nowMs: 20 * Hour);

        Assert.Equal(12_960_000d, ms);
    }

    [Fact]
    public void EffectiveMsInWindow_OutsideTheWindowOrEmpty_IsZero()
    {
        Assert.Equal(0d, PauseMath.EffectiveMsInWindow(0, Hour, 0, null, 2 * Hour, 3 * Hour, 4 * Hour));
        Assert.Equal(0d, PauseMath.EffectiveMsInWindow(Hour, Hour, 0, null, 0, 2 * Hour, 4 * Hour));
    }

    [Fact]
    public void EffectiveMsInWindow_RoundsHalfUpToWholeMilliseconds()
    {
        // 2 s of wall time with 1 s paused: 1000 ms effective; 1 ms of the 2000 ms is inside the window -> 1000 * 1 / 2000 = 0.5 -> 1.
        Assert.Equal(1d, PauseMath.EffectiveMsInWindow(0, 2000, pausedSeconds: 1, pausedAtMs: null, fromMs: 0, toMs: 1, nowMs: 2000));
    }
}

public sealed class ClinicalStatisticsTests
{
    [Fact]
    public void Mean_Empty_IsNull_Otherwise_TheAverage()
    {
        Assert.Null(ClinicalStatistics.Mean([]));
        Assert.Equal(2.5, ClinicalStatistics.Mean([1, 2, 3, 4]));
    }

    [Theory]
    [InlineData(new double[0], null)]
    [InlineData(new[] { 5d }, 5d)]
    [InlineData(new[] { 3d, 1d, 2d }, 2d)]
    [InlineData(new[] { 4d, 1d, 3d, 2d }, 2.5d)]
    public void Median_OddEvenAndEmpty(double[] values, double? expected)
    {
        Assert.Equal(expected, ClinicalStatistics.Median(values));
    }

    [Theory]
    [InlineData(0.4, 0)]
    [InlineData(0.5, 1)]
    [InlineData(427.5, 428)]
    [InlineData(2.4999, 2)]
    public void RoundHalfUp_LikeMathRoundForPositiveValues(double value, double expected)
    {
        Assert.Equal(expected, ClinicalStatistics.RoundHalfUp(value));
    }

    [Fact]
    public void CompletedDaysWithData_LeavesTodayOutUnlessItIsTheOnlyOne()
    {
        var today = new DateOnly(2026, 1, 10);
        var days = new[] { (Date: new DateOnly(2026, 1, 8), Count: 1), (Date: new DateOnly(2026, 1, 9), Count: 0), (Date: today, Count: 3) };

        var finished = ClinicalStatistics.CompletedDaysWithData(days, day => day.Count > 0, day => day.Date, today);
        var onlyToday = ClinicalStatistics.CompletedDaysWithData(days.Skip(1), day => day.Count > 0, day => day.Date, today);

        Assert.Equal([days[0]], finished);
        Assert.Equal([days[2]], onlyToday);
    }
}

public sealed class MedicationUsageTests
{
    private static readonly Guid Dipyrone = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid Vitamin = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    private static GivenMedication Dose(Guid? id, string? name, int day, int hour = 8) =>
        new(new DateTimeOffset(2026, 1, day, hour, 0, 0, TimeSpan.Zero), id, name);

    [Fact]
    public void Summarize_GroupsByMedicationMostGivenFirstWithTheLatestName()
    {
        var doses = new[]
        {
            Dose(Vitamin, "Vit D", 3),
            Dose(Dipyrone, "Dipirona", 1),
            Dose(Dipyrone, "Dipirona 500", 2),
            Dose(Dipyrone, "Dipirona 500", 4, 20),
        };

        var usage = MedicationUsages.Summarize(doses);

        Assert.Equal(
            [new MedicationUsage(Dipyrone, "Dipirona 500", 3, doses[3].GivenAt), new MedicationUsage(Vitamin, "Vit D", 1, doses[0].GivenAt)],
            usage.ToArray());
    }

    [Fact]
    public void Summarize_DosesWithoutAnIdAreGroupedByNameIgnoringCase()
    {
        var doses = new[] { Dose(null, "Probiotic", 1), Dose(null, " probiotic ", 2), Dose(null, "Other", 3) };

        var usage = MedicationUsages.Summarize(doses);

        Assert.Equal([("probiotic", 2), ("Other", 1)], usage.Select(item => (item.Name, item.Count)).ToArray());
        Assert.All(usage, item => Assert.Null(item.MedicationId));
    }

    [Fact]
    public void Summarize_TiesOnCount_LatestGivenFirstThenName()
    {
        var doses = new[] { Dose(Vitamin, "Vit D", 5), Dose(Dipyrone, "Dipirona", 2) };

        var usage = MedicationUsages.Summarize(doses);

        Assert.Equal([Vitamin, Dipyrone], usage.Select(item => item.MedicationId!.Value).ToArray());
    }

    [Fact]
    public void Summarize_NoDoses_IsEmpty()
    {
        Assert.Empty(MedicationUsages.Summarize([]));
    }

    [Fact]
    public void ReadGiven_TheNamesOfAStoredPayload_AreCopiedAndOddEntriesTolerated()
    {
        var payload = EventPayload.From($$"""{"medications":[{"medicationId":"{{Dipyrone}}","name":"Dipirona"},{"name":"Loose"},{"medicationId":5,"name":7},"junk"]}""");
        var givenAt = new DateTimeOffset(2026, 1, 9, 8, 0, 0, TimeSpan.Zero);

        var given = MedicationDosePayload.ReadGiven(payload, givenAt);

        Assert.Equal([new GivenMedication(givenAt, Dipyrone, "Dipirona"), new GivenMedication(givenAt, null, "Loose"), new GivenMedication(givenAt, null, null)], given.ToArray());
    }

    [Fact]
    public void ReadGiven_NoMedications_IsEmpty()
    {
        Assert.Empty(MedicationDosePayload.ReadGiven(EventPayload.Empty, DateTimeOffset.UnixEpoch));
    }
}

public sealed class VaccineOverviewTests
{
    private static readonly DateOnly Birth = new(2026, 1, 1);

    private static VaccineOverview Overview(DateOnly today, params VaccinationRecord[] records)
    {
        var schedule = VaccineScheduleFixtures.Schedule(
            VaccineScheduleFixtures.Dose("d0", 0, "bcg"),
            VaccineScheduleFixtures.Dose("d60", 60, "penta"),
            VaccineScheduleFixtures.Dose("d365", 365, "mmr"));
        var status = VaccineStatusCalculator.Calculate(new VaccineStatusInput(schedule, VaccineProfile.Default, Birth, records, today));
        return VaccineOverview.Of(status, schedule);
    }

    [Fact]
    public void Of_CountsEachStateAndListsTheDueDosesByDueDate()
    {
        var overview = Overview(new DateOnly(2026, 3, 15));

        Assert.Equal((0, 1, 1, 1), (overview.Given, overview.Due, overview.Overdue, overview.Upcoming));
        Assert.Equal(2, overview.DueOrOverdue);
        Assert.Equal(
            [("d0", DoseState.Overdue, new DateOnly(2026, 1, 1)), ("d60", DoseState.Due, new DateOnly(2026, 3, 2))],
            overview.DueDoses.Select(dose => (dose.DoseId, dose.State, dose.DueOn)).ToArray());
    }

    [Fact]
    public void Of_ADoseGiven_LeavesTheDueList()
    {
        var overview = Overview(new DateOnly(2026, 3, 15), new VaccinationRecord(Guid.NewGuid(), "d0", new DateOnly(2026, 1, 3)));

        Assert.Equal((1, 1, 0, 1), (overview.Given, overview.Due, overview.Overdue, overview.Upcoming));
        Assert.Equal(["d60"], overview.DueDoses.Select(dose => dose.DoseId).ToArray());
    }

    [Fact]
    public void Of_DueDoseCarriesTheVaccineAndDoseNamesPerLanguage()
    {
        var overview = Overview(new DateOnly(2026, 3, 15));

        var dose = overview.DueDoses.Single(item => item.DoseId == "d60");

        Assert.Equal("penta", dose.VaccineKey);
        Assert.Equal("penta (detail)", dose.VaccineNames.Values["en"]);
        Assert.Equal("penta pt (detalhe)", dose.VaccineNames.Values["pt-BR"]);
        Assert.Equal("d60", dose.DoseLabel.Values["en"]);
    }

    [Fact]
    public void Of_BeforeAnythingIsDue_IsAllUpcomingExceptTheBirthDose()
    {
        var overview = Overview(Birth);

        Assert.Equal((0, 1, 0, 2), (overview.Given, overview.Due, overview.Overdue, overview.Upcoming));
    }
}

public sealed class ClinicalObservationsTests
{
    private static Event Stored(string json, DateTimeOffset? end = null)
    {
        var start = new DateTimeOffset(2026, 1, 9, 8, 0, 0, TimeSpan.Zero);
        return Event.Create(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), start, end, EventPayload.From(json), null, start);
    }

    [Fact]
    public void Sleep_ReadsKindAndPauseKeys()
    {
        var pausedAt = new DateTimeOffset(2026, 1, 9, 8, 30, 0, TimeSpan.Zero);

        var observed = ClinicalObservations.Sleep(Stored($$"""{"kind":"night","paused_seconds":600,"paused_at":"{{pausedAt:O}}"}"""));

        Assert.Equal(("night", 600, pausedAt), (observed.Kind, observed.PausedSeconds, observed.PausedAt));
        Assert.True(observed.IsSession);
    }

    [Fact]
    public void Sleep_NoKind_IsANap()
    {
        var observed = ClinicalObservations.Sleep(Stored("{}"));

        Assert.Null(observed.Kind);
        Assert.True(observed.IsSession);
        Assert.False(observed.IsNight);
    }

    [Fact]
    public void Feed_ReadsMethodAmountTypeAndFormula()
    {
        var formula = Guid.NewGuid();

        var observed = ClinicalObservations.Feed(Stored($$"""{"method":"bottle","amount_ml":120.5,"bottle_feeding_type":"formula","formula_id":"{{formula}}","formula_name":"Aptamil"}"""));

        Assert.Equal(("bottle", 120.5, "formula", formula, "Aptamil"), (observed.Method, observed.AmountMl, observed.BottleFeedingType, observed.FormulaId, observed.FormulaName));
        Assert.True(observed.IsFormulaBottle);
    }

    [Fact]
    public void Feed_OddMembers_ReadAsNoValue()
    {
        var observed = ClinicalObservations.Feed(Stored("""{"method":3,"amount_ml":"much","formula_id":"not-a-guid"}"""));

        Assert.Equal((null, null, null), (observed.Method, observed.AmountMl, observed.FormulaId));
        Assert.False(observed.IsBottle);
    }

    [Fact]
    public void Diaper_ReadsContent_AnyCase()
    {
        var observed = ClinicalObservations.Diaper(Stored("""{"content":"mixed"}"""));

        Assert.True(observed.IsWet);
        Assert.True(observed.IsDirty);
    }

    [Fact]
    public void Diaper_NoContent_IsNeitherWetNorDirty()
    {
        var observed = ClinicalObservations.Diaper(Stored("{}"));

        Assert.Equal((false, false), (observed.IsWet, observed.IsDirty));
    }
}
