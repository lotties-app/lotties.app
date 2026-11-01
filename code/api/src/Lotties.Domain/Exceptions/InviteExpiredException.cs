namespace Lotties.Domain.Exceptions;

/// <summary>An invite was used after its expiry.</summary>
public sealed class InviteExpiredException : DomainException
{
    public InviteExpiredException(Guid inviteId, DateTimeOffset expiresAt)
        : base("invite_expired", $"Invite {inviteId} expired at {expiresAt:O}.")
    {
        InviteId = inviteId;
        ExpiresAt = expiresAt;
    }

    public Guid InviteId { get; }

    public DateTimeOffset ExpiresAt { get; }
}
