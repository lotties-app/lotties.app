namespace Lotties.Domain.Exceptions;

/// <summary>The user is not a member of the baby.</summary>
public sealed class MemberNotFoundException : DomainException
{
    public MemberNotFoundException(Guid babyId, Guid userId)
        : base("member_not_found", $"User {userId} is not a member of baby {babyId}.")
    {
        BabyId = babyId;
        UserId = userId;
    }

    public Guid BabyId { get; }

    public Guid UserId { get; }
}
