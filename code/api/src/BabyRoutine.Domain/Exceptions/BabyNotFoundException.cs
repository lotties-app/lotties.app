namespace BabyRoutine.Domain.Exceptions;

/// <summary>No baby with the id exists.</summary>
public sealed class BabyNotFoundException : DomainException
{
    public BabyNotFoundException(Guid babyId)
        : base("baby_not_found", $"Baby {babyId} was not found.")
    {
        BabyId = babyId;
    }

    public Guid BabyId { get; }
}
