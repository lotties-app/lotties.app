namespace BabyRoutine.Domain.Exceptions;

/// <summary>An invite was used after it had already been accepted.</summary>
public sealed class InviteAlreadyAcceptedException : DomainException
{
    public InviteAlreadyAcceptedException(Guid inviteId)
        : base("invite_already_accepted", $"Invite {inviteId} has already been accepted.")
    {
        InviteId = inviteId;
    }

    public Guid InviteId { get; }
}
