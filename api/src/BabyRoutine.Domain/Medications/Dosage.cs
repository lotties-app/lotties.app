using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Medications;

/// <summary>A positive dose amount with its unit (e.g. 2.5 ml).</summary>
public sealed record Dosage
{
    public const int UnitMaxLength = 20;

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
        if (amount <= 0)
        {
            throw new DomainValidationException(nameof(Amount), "Dose amount must be positive.");
        }

        return new Dosage(amount, Text.Required(unit, nameof(Unit), UnitMaxLength));
    }
}
