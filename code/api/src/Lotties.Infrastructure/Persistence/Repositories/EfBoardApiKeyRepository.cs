using Lotties.Domain.Board;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// <see cref="RecordUseAsync"/> is one conditional <c>UPDATE</c> (no read): the row changes only when its last recorded use
/// is older than <see cref="BoardApiKey.UseRecordInterval"/>, so a busy key writes at most once a minute and concurrent
/// requests never double count.
/// </remarks>
internal sealed class EfBoardApiKeyRepository(LottiesDbContext context) : IBoardApiKeyRepository
{
    public async Task<IReadOnlyList<BoardApiKey>> ListAsync(CancellationToken cancellationToken = default)
    {
        var keys = await context.BoardApiKeys.AsNoTracking().ToListAsync(cancellationToken);
        return keys.OrderByDescending(key => key.CreatedAt).ThenBy(key => key.Id).ToArray();
    }

    public async Task<IReadOnlyList<BoardApiKey>> FindByPrefixAsync(string prefix, CancellationToken cancellationToken = default) =>
        await context.BoardApiKeys.AsNoTracking().Where(key => key.Prefix == prefix).ToListAsync(cancellationToken);

    public Task<BoardApiKey?> FindAsync(Guid id, CancellationToken cancellationToken = default) =>
        context.BoardApiKeys.SingleOrDefaultAsync(key => key.Id == id, cancellationToken);

    public void Add(BoardApiKey key) => context.BoardApiKeys.Add(key);

    public Task RecordUseAsync(Guid keyId, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var before = now - BoardApiKey.UseRecordInterval;
        return context.BoardApiKeys
            .Where(key => key.Id == keyId && (key.LastUsedAt == null || key.LastUsedAt <= before))
            .ExecuteUpdateAsync(setters => setters.SetProperty(key => key.LastUsedAt, (DateTimeOffset?)now).SetProperty(key => key.UseCount, key => key.UseCount + 1), cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
