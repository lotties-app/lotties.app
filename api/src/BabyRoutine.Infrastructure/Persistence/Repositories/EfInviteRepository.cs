using BabyRoutine.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

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

    public async Task RemoveAsync(Invite invite, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(invite);
        context.Invites.Remove(invite);
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
