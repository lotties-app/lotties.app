namespace BabyRoutine.Domain.Exceptions;

/// <summary>The user is already a member of the baby.</summary>
public sealed class MemberAlreadyExistsException : DomainException
{
    public MemberAlreadyExistsException(Guid babyId, Guid userId)
        : base("member_already_exists", $"User {userId} is already a member of baby {babyId}.")
    {
        BabyId = babyId;
        UserId = userId;
    }

    public Guid BabyId { get; }

    public Guid UserId { get; }
}
