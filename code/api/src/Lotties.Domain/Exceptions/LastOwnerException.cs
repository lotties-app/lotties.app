namespace Lotties.Domain.Exceptions;

/// <summary>A change would leave the baby without an owner.</summary>
public sealed class LastOwnerException : DomainException
{
    public LastOwnerException(Guid babyId, Guid userId)
        : base("last_owner_required", $"User {userId} is the last owner of baby {babyId}; promote another member first.")
    {
        BabyId = babyId;
        UserId = userId;
    }

    public Guid BabyId { get; }

    public Guid UserId { get; }
}
