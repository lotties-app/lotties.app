using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

internal sealed class EfDemoAccountRepository(LottiesDbContext context) : IDemoAccountRepository
{
    public Task<int> CountAsync(CancellationToken cancellationToken = default) =>
        context.Users.AsNoTracking().CountAsync(user => user.Issuer == User.DemoIssuer, cancellationToken);

    public async Task<IReadOnlyList<Guid>> ListExpiredIdsAsync(DateTimeOffset now, int take, CancellationToken cancellationToken = default) =>
        await context.Users.AsNoTracking()
            .Where(user => user.Issuer == User.DemoIssuer && user.DemoExpiresAt != null && user.DemoExpiresAt <= now)
            .OrderBy(user => user.DemoExpiresAt)
            .Select(user => user.Id)
            .Take(take)
            .ToListAsync(cancellationToken);

    public async Task<bool> DeleteUserRowAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await context.Users.Where(user => user.Id == userId).ExecuteDeleteAsync(cancellationToken) > 0;
        }
        catch (DbUpdateException)
        {
            // Something still points at the row; it stays as an anonymous, expired-less account (nothing personal left).
            return false;
        }
    }
}
