using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Medications;

namespace BabyRoutine.Domain.Prescriptions;

/// <summary>
/// The prescribed dose: <see cref="Amount"/> <see cref="Unit"/> per dose, or per kg of body weight when
/// <see cref="PerKg"/> (then <see cref="RoundingStep"/> optionally rounds the computed amount, e.g. 0.5 or 1 drop).
/// Amounts follow <see cref="Dosage"/> (3 decimals, 0.001-9999999.999, the <c>numeric(10,3)</c> column); the step is
/// 0.001-1000 and only allowed with <see cref="PerKg"/>.
/// </summary>
public sealed record DoseRule
{
    public const decimal MaxRoundingStep = 1000m;

    private DoseRule()
    {
        Unit = string.Empty;
    }

    private DoseRule(decimal amount, string unit, bool perKg, decimal? roundingStep)
    {
        Amount = amount;
        Unit = unit;
        PerKg = perKg;
        RoundingStep = roundingStep;
    }

    public decimal Amount { get; private set; }

    public string Unit { get; private set; }

    public bool PerKg { get; private set; }

    public decimal? RoundingStep { get; private set; }

    public static DoseRule Create(decimal amount, string unit, bool perKg, decimal? roundingStep)
    {
        var validAmount = ValidAmount(amount);
        var validUnit = Text.Required(unit, "dose.unit", Dosage.UnitMaxLength);
        var validStep = ValidRoundingStep(roundingStep, perKg);
        return new DoseRule(validAmount, validUnit, perKg, validStep);
    }

    /// <summary>The per-kg suggestion for <paramref name="weight"/>; <c>null</c> when the rule is not per kg or no weight is known.</summary>
    public SuggestedDose? SuggestFor(BodyWeight? weight, DateOnly today)
    {
        if (!PerKg || weight is null)
        {
            return null;
        }

        var exact = Math.Round(Amount * weight.Kg, Dosage.AmountDecimalPlaces, MidpointRounding.AwayFromZero);
        return new SuggestedDose(RoundToStep(exact), exact, Unit, Amount, weight.Kg, weight.Date, weight.IsStaleOn(today), RoundingStep);
    }

    private decimal RoundToStep(decimal exact) =>
        RoundingStep is { } step ? Math.Round(exact / step, MidpointRounding.AwayFromZero) * step : exact;

    private static decimal ValidAmount(decimal amount)
    {
        var rounded = Math.Round(amount, Dosage.AmountDecimalPlaces, MidpointRounding.AwayFromZero);
        return rounded > 0 && rounded <= Dosage.MaxAmount
            ? rounded
            : throw new DomainValidationException("dose.amount", $"dose.amount must be between 0.001 and {Dosage.MaxAmount}.");
    }

    private static decimal? ValidRoundingStep(decimal? roundingStep, bool perKg)
    {
        if (roundingStep is null)
        {
            return null;
        }

        var rounded = Math.Round(roundingStep.Value, Dosage.AmountDecimalPlaces, MidpointRounding.AwayFromZero);
        return perKg && rounded > 0 && rounded <= MaxRoundingStep
            ? rounded
            : throw new DomainValidationException("dose.roundingStep", $"dose.roundingStep is only for per-kg doses and must be between 0.001 and {MaxRoundingStep}.");
    }
}
