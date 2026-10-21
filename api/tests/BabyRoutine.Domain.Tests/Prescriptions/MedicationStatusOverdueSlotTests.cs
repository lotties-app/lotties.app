using static BabyRoutine.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace BabyRoutine.Domain.Tests.Prescriptions;

public sealed class MedicationStatusOverdueSlotTests
{
    private const int SaoPaulo = -180;
    private static readonly Guid MedicationA = Guid.NewGuid();

    [Fact]
    public void OverdueSlotAt_TimesOfDayLate_IsTheSlotOverdueByCountsFrom()
    {
        var now = Local(2026, 3, 2, 9, 0, SaoPaulo);

        var status = Calculate([AtTimes(MedicationA, ["08:00", "20:00"])], [], now, SaoPaulo).Single();

        Assert.Equal(Local(2026, 3, 2, 8, 0, SaoPaulo), status.OverdueSlotAt);
        Assert.Equal(now, status.OverdueSlotAt!.Value + status.OverdueBy!.Value);
        Assert.Equal(Local(2026, 3, 2, 20, 0, SaoPaulo), status.NextScheduledAt);
    }

    [Fact]
    public void OverdueSlotAt_BeforeTheSlotOrTaken_IsNull()
    {
        var prescription = AtTimes(MedicationA, ["08:00"]);

        var before = Calculate([prescription], [], Local(2026, 3, 2, 7, 0, SaoPaulo), SaoPaulo).Single();
        var taken = Calculate([prescription], [Dose(Local(2026, 3, 2, 8, 10, SaoPaulo), MedicationA)], Local(2026, 3, 2, 9, 0, SaoPaulo), SaoPaulo).Single();

        Assert.Null(before.OverdueSlotAt);
        Assert.Null(taken.OverdueSlotAt);
    }

    [Fact]
    public void OverdueSlotAt_EveryNMinutesPastDue_IsTheNextScheduledTime()
    {
        var prescription = Every(MedicationA, 240);
        var now = Local(2026, 3, 2, 9, 0, SaoPaulo);

        var status = Calculate([prescription], [Dose(Local(2026, 3, 2, 4, 0, SaoPaulo), MedicationA, prescription.Id)], now, SaoPaulo).Single();

        Assert.Equal((Local(2026, 3, 2, 8, 0, SaoPaulo), Local(2026, 3, 2, 8, 0, SaoPaulo), TimeSpan.FromHours(1)), (status.OverdueSlotAt!.Value, status.NextScheduledAt!.Value, status.OverdueBy!.Value));
    }

    [Fact]
    public void OverdueSlotAt_AsNeeded_IsNull()
    {
        var status = Calculate([AsNeeded(MedicationA, 240)], [Dose(Local(2026, 3, 2, 1, 0, SaoPaulo), MedicationA)], Local(2026, 3, 2, 9, 0, SaoPaulo), SaoPaulo).Single();

        Assert.Null(status.OverdueSlotAt);
    }
}
