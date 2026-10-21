using BabyRoutine.Domain.Babies;
using BabyRoutine.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>Invites carry an <c>xmin</c> row version; a lost race on save is translated by <see cref="ConcurrencyConflicts"/>.</remarks>
internal sealed class EfInviteRepository(BabyRoutineDbContext context) : IInviteRepository
{
    public async Task AddAsync(Invite invite, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(invite);
        context.Invites.Add(invite);
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task<Invite?> FindByHashedTokenAsync(InviteToken hashedToken, CancellationToken cancellationToken = default) =>
        context.Invites.SingleOrDefaultAsync(invite => invite.Token == hashedToken, cancellationToken);

    public Task<Invite?> FindForBabyAsync(Guid babyId, Guid inviteId, CancellationToken cancellationToken = default) =>
        context.Invites.SingleOrDefaultAsync(invite => invite.BabyId == babyId && invite.Id == inviteId, cancellationToken);

    public async Task<IReadOnlyList<Invite>> ListPendingAsync(Guid babyId, DateTimeOffset now, CancellationToken cancellationToken = default) =>
        await context.Invites
            .AsNoTracking()
            .Where(invite => invite.BabyId == babyId && invite.AcceptedAt == null && invite.ExpiresAt > now)
            .OrderByDescending(invite => invite.CreatedAt)
            .ThenBy(invite => invite.Id)
            .ToListAsync(cancellationToken);

    /// <remarks>
    /// An invite deleted concurrently counts as removed (revoking is idempotent); one accepted concurrently is
    /// <see cref="Domain.Exceptions.InviteAlreadyAcceptedException"/>.
    /// </remarks>
    public async Task RemoveAsync(Invite invite, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(invite);
        context.Invites.Remove(invite);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            var conflict = await ConcurrencyConflicts.TranslateAsync(exception, cancellationToken);
            context.Entry(invite).State = EntityState.Detached;
            ThrowUnlessAlreadyGone(conflict);
        }
    }

    public async Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw await ConcurrencyConflicts.TranslateAsync(exception, cancellationToken);
        }
    }

    private static void ThrowUnlessAlreadyGone(Domain.Exceptions.DomainException conflict)
    {
        if (conflict is not Domain.Exceptions.InviteNotFoundException)
        {
            throw conflict;
        }
    }
}
