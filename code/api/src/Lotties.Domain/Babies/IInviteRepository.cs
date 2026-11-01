namespace Lotties.Domain.Babies;

/// <summary>Persistence for <see cref="Invite"/>. Invites are stored by token hash (see <see cref="InviteToken.Hash"/>).</summary>
public interface IInviteRepository
{
    Task AddAsync(Invite invite, CancellationToken cancellationToken = default);

    /// <summary>The invite whose stored (hashed) token is <paramref name="hashedToken"/>; tracked for changes.</summary>
    Task<Invite?> FindByHashedTokenAsync(InviteToken hashedToken, CancellationToken cancellationToken = default);

    /// <summary>The invite of <paramref name="babyId"/> with <paramref name="inviteId"/>; tracked for changes.</summary>
    Task<Invite?> FindForBabyAsync(Guid babyId, Guid inviteId, CancellationToken cancellationToken = default);

    /// <summary>Invites of the baby that are neither accepted nor expired at <paramref name="now"/>, newest first.</summary>
    Task<IReadOnlyList<Invite>> ListPendingAsync(Guid babyId, DateTimeOffset now, CancellationToken cancellationToken = default);

    Task RemoveAsync(Invite invite, CancellationToken cancellationToken = default);

    /// <summary>Saves changes made to invites returned by this repository (shares the unit of work of <see cref="IBabyRepository"/>).</summary>
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
