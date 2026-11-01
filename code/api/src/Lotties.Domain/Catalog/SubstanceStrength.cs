using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Medications;

namespace Lotties.Domain.Catalog;

/// <summary>
/// How much of a substance a product contains, e.g. 75 mg per 1 mL (<see cref="PerAmount"/>/<see cref="PerUnit"/> are
/// optional: 500 mg per tablet has none). Composition only, never a dose. Amounts follow <see cref="Dosage"/>: rounded to
/// 3 decimals, 0.001-9999999.999; units 1-20 characters.
/// </summary>
public sealed record SubstanceStrength
{
    private SubstanceStrength()
    {
        Unit = string.Empty;
    }

    private SubstanceStrength(decimal amount, string unit, decimal? perAmount, string? perUnit)
    {
        Amount = amount;
        Unit = unit;
        PerAmount = perAmount;
        PerUnit = perUnit;
    }

    public decimal Amount { get; private set; }

    public string Unit { get; private set; }

    public decimal? PerAmount { get; private set; }

    public string? PerUnit { get; private set; }

    public static SubstanceStrength Create(decimal amount, string unit, decimal? perAmount, string? perUnit)
    {
        var strength = Positive(amount, "strength.amount");
        var strengthUnit = Text.Required(unit, "strength.unit", Dosage.UnitMaxLength);
        var per = perAmount is null ? null : (decimal?)Positive(perAmount.Value, "strength.perAmount");
        var validPerUnit = Text.Optional(perUnit, "strength.perUnit", Dosage.UnitMaxLength);
        EnsurePerIsComplete(per, validPerUnit);
        return new SubstanceStrength(strength, strengthUnit, per, validPerUnit);
    }

    private static decimal Positive(decimal value, string field)
    {
        var rounded = Math.Round(value, Dosage.AmountDecimalPlaces, MidpointRounding.AwayFromZero);
        return rounded > 0 && rounded <= Dosage.MaxAmount
            ? rounded
            : throw new DomainValidationException(field, $"{field} must be between 0.001 and {Dosage.MaxAmount}.");
    }

    private static void EnsurePerIsComplete(decimal? perAmount, string? perUnit)
    {
        if ((perAmount is null) != (perUnit is null))
        {
            throw new DomainValidationException("strength.perUnit", "strength.perAmount and strength.perUnit go together.");
        }
    }
}
