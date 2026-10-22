using Lotties.Domain.Medications;

namespace Lotties.Domain.Tests.Medications;

public sealed class DoseUnitsTests
{
    [Theory]
    [InlineData("spray", CountedDoseUnit.Spray)]
    [InlineData(" Sprays ", CountedDoseUnit.Spray)]
    [InlineData("jatos", CountedDoseUnit.Spray)]
    [InlineData("borrifada", CountedDoseUnit.Spray)]
    [InlineData("puffs", CountedDoseUnit.Puff)]
    [InlineData("INALAÇÃO", CountedDoseUnit.Puff)]
    [InlineData("suppositories", CountedDoseUnit.Suppository)]
    [InlineData("supositorio", CountedDoseUnit.Suppository)]
    [InlineData("application", CountedDoseUnit.Application)]
    [InlineData("aplicações", CountedDoseUnit.Application)]
    public void CountedUnitOf_EnglishAndPortugueseAliases_AreRecognised(string unit, CountedDoseUnit expected)
    {
        var counted = DoseUnits.CountedUnitOf(unit);

        Assert.Equal(expected, counted);
    }

    [Theory]
    [InlineData("drops")]
    [InlineData("gotas")]
    [InlineData("ml")]
    [InlineData("mg")]
    [InlineData("tablet")]
    [InlineData("")]
    [InlineData(null)]
    public void CountedUnitOf_MeasuredOrUnknownUnit_IsNull(string? unit)
    {
        Assert.Null(DoseUnits.CountedUnitOf(unit));
    }

    [Theory]
    [InlineData(CountedDoseUnit.Spray, 1.0)]
    [InlineData(CountedDoseUnit.Puff, 1.0)]
    [InlineData(CountedDoseUnit.Suppository, 0.5)]
    [InlineData(CountedDoseUnit.Application, null)]
    public void AmountStepOf_WholeSpraysAndPuffsHalfSuppositoriesAnyApplication(CountedDoseUnit unit, double? expected)
    {
        Assert.Equal((decimal?)expected, DoseUnits.AmountStepOf(unit));
    }
}
