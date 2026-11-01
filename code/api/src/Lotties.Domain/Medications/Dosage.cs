using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Medications;

/// <summary>
/// A positive dose amount with its unit (e.g. 2.5 ml). The amount is rounded to <see cref="AmountDecimalPlaces"/>
/// decimals and at most <see cref="MaxAmount"/>, which fits the <c>numeric(10,3)</c> column.
/// </summary>
public sealed record Dosage
{
    public const int UnitMaxLength = 20;
    public const int AmountDecimalPlaces = 3;
    public const decimal MaxAmount = 9_999_999.999m;

    private Dosage()
    {
        Unit = string.Empty;
    }

    private Dosage(decimal amount, string unit)
    {
        Amount = amount;
        Unit = unit;
    }

    public decimal Amount { get; private set; }

    public string Unit { get; private set; }

    public static Dosage Create(decimal amount, string unit)
    {
        var rounded = Math.Round(amount, AmountDecimalPlaces, MidpointRounding.AwayFromZero);
        if (rounded <= 0)
        {
            throw new DomainValidationException(nameof(Amount), "Dose amount must be positive (at least 0.001).");
        }

        if (rounded > MaxAmount)
        {
            throw new DomainValidationException(nameof(Amount), "Dose amount must be at most 9999999.999.");
        }

        return new Dosage(rounded, Text.Required(unit, nameof(Unit), UnitMaxLength));
    }
}
