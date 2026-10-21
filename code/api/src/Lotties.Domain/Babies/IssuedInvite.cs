namespace Lotties.Domain.Babies;

/// <summary>
/// A freshly issued invite together with its plain token. Only the hash of <see cref="Token"/> is stored on
/// <see cref="Invite"/>; the plain token exists here once and must be handed to the inviter immediately.
/// </summary>
public sealed record IssuedInvite(Invite Invite, InviteToken Token);
