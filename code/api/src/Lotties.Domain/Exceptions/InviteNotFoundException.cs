namespace Lotties.Domain.Exceptions;

/// <summary>No invite matches the token (unknown, malformed or revoked).</summary>
public sealed class InviteNotFoundException : DomainException
{
    public InviteNotFoundException()
        : base("invite_not_found", "The invite was not found.")
    {
    }
}
