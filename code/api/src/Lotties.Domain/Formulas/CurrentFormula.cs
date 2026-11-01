using Lotties.Domain.Events;

namespace Lotties.Domain.Formulas;

/// <summary>
/// The rule "at most one current formula per baby": when a write makes a formula current, every other current formula
/// of the same baby yields (<see cref="Formula.YieldCurrentTo"/>), stamped with the client time of the write that caused
/// it, so the change reaches every device through the delta and an older offline write cannot bring two back.
/// </summary>
public static class CurrentFormula
{
    /// <summary>
    /// Makes room before formula <paramref name="formulaId"/> of <paramref name="babyId"/> is saved with
    /// <paramref name="terms"/>: when they are current, every other current formula of the baby among
    /// <paramref name="babyFormulas"/> stops being current. Returns the formulas that yielded (none otherwise).
    /// </summary>
    public static IReadOnlyList<Formula> MakeRoom(
        Guid babyId,
        Guid formulaId,
        FormulaTerms terms,
        IEnumerable<Formula> babyFormulas,
        DateTimeOffset? clientUpdatedAt,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(terms);
        ArgumentNullException.ThrowIfNull(babyFormulas);
        if (!terms.IsCurrent)
        {
            return [];
        }

        var cause = ClientEditTime.Bound(clientUpdatedAt, now);
        var yielding = babyFormulas.Where(formula => formula.BabyId == babyId && formula.Id != formulaId && formula.IsCurrent).ToArray();
        Array.ForEach(yielding, formula => formula.YieldCurrentTo(cause, now));
        return yielding;
    }
}
