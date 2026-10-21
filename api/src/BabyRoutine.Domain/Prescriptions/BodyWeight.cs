namespace BabyRoutine.Domain.Prescriptions;

/// <summary>The baby's weight on a day (the latest growth measurement with a weight).</summary>
public sealed record BodyWeight(decimal Kg, DateOnly Date)
{
    /// <summary>A weight older than this many days is flagged as stale for per-kg suggestions.</summary>
    public const int StaleAfterDays = 30;

    /// <summary>Whether the weight was measured more than <see cref="StaleAfterDays"/> days before <paramref name="today"/>.</summary>
    public bool IsStaleOn(DateOnly today) => Date < today.AddDays(-StaleAfterDays);
}

/// <summary>
/// A per-kg dose computed from the doctor's rule and the latest weight, with every input shown: the exact product
/// (<see cref="ExactAmount"/> = <see cref="PerKgAmount"/> x <see cref="KgUsed"/>, 3 decimals) and <see cref="Amount"/>,
/// the exact amount rounded to the nearest multiple of <see cref="RoundingStep"/> (midpoint away from zero; equal to the
/// exact amount without a step; may be 0 when the step is larger than twice the exact amount). Information for the
/// parent to confirm, never applied automatically.
/// </summary>
public sealed record SuggestedDose(
    decimal Amount,
    decimal ExactAmount,
    string Unit,
    decimal PerKgAmount,
    decimal KgUsed,
    DateOnly WeightDate,
    bool Stale,
    decimal? RoundingStep);
