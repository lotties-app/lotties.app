namespace Lotties.Domain.Exceptions;

/// <summary>An upsert addressed an existing formula through a baby it does not belong to.</summary>
public sealed class FormulaBabyMismatchException : DomainException
{
    public FormulaBabyMismatchException(Guid formulaId, Guid requestedBabyId)
        : base("formula_baby_mismatch", $"Formula {formulaId} does not belong to baby {requestedBabyId}; a formula cannot change baby.")
    {
        FormulaId = formulaId;
        RequestedBabyId = requestedBabyId;
    }

    public Guid FormulaId { get; }

    public Guid RequestedBabyId { get; }
}
