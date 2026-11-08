using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// <c>data_store_moves</c> on the control context (task T7). A save is the whole unit of work of the context, so a move and the baby's
/// store pointer switch in one transaction. A concurrent writer of the same row (the <c>xmin</c> row version on PostgreSQL) or a
/// concurrent first insert of the same baby (the primary key) makes <see cref="TrySaveAsync"/> return <c>false</c> with nothing saved;
/// every tracked entity is then dropped, so the next read sees the stored rows again.
/// </remarks>
internal sealed class EfDataStoreMoveRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : IDataStoreMoveRepository
{
    public Task<DataStoreMove?> FindAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        context.DataStoreMoves.SingleOrDefaultAsync(move => move.BabyId == babyId, cancellationToken);

    public async Task<StoreWriteBlock> WriteBlockAsync(Guid babyId, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var deletionStartedAt = await context.BabyStoreAssignments.AsNoTracking()
            .Where(row => row.BabyId == babyId)
            .Select(row => row.AccountDeletionStartedAt)
            .SingleOrDefaultAsync(cancellationToken);
        if (AccountDeletionBlock.IsActive(deletionStartedAt, now))
        {
            return StoreWriteBlock.AccountDeleting;
        }

        var move = await context.DataStoreMoves.AsNoTracking().SingleOrDefaultAsync(row => row.BabyId == babyId, cancellationToken);
        return move is not null && move.BlocksWrites(now) ? StoreWriteBlock.Moving : StoreWriteBlock.None;
    }

    public async Task<IReadOnlyList<Guid>> ListDueAsync(DateTimeOffset now, int limit, CancellationToken cancellationToken = default) =>
        await context.DataStoreMoves.AsNoTracking()
            .Where(move => move.LeaseUntil == null || move.LeaseUntil <= now)
            .Where(move => move.State == DataStoreMoveState.Copying
                || move.State == DataStoreMoveState.Verifying
                || (move.NextCleanupAt != null && move.NextCleanupAt <= now))
            .OrderBy(move => move.UpdatedAt)
            .Select(move => move.BabyId)
            .Take(limit)
            .ToListAsync(cancellationToken);

    public void Add(DataStoreMove move) => context.DataStoreMoves.Add(move);

    /// <remarks>
    /// The conditional update takes the baby's row lock (PostgreSQL waits for a deletion that holds it and then re-checks the block) and
    /// clears a stale block on the way; it matches nothing while a deletion blocks the baby, or when the baby row is gone.
    /// </remarks>
    public async Task<DataStoreMoveSave> TrySaveUnlessDeletingAsync(Guid babyId, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var staleBefore = AccountDeletionBlock.StaleBefore(now);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        var taken = await context.BabyStoreAssignments
            .Where(row => row.BabyId == babyId && (row.AccountDeletionStartedAt == null || row.AccountDeletionStartedAt <= staleBefore))
            .ExecuteUpdateAsync(setters => setters.SetProperty(row => row.AccountDeletionStartedAt, (DateTimeOffset?)null), cancellationToken);
        if (taken == 0)
        {
            context.ChangeTracker.Clear();
            return DataStoreMoveSave.AccountDeleting;
        }

        if (!await TrySaveAsync(cancellationToken))
        {
            return DataStoreMoveSave.Conflict;
        }

        await transaction.CommitAsync(cancellationToken);
        return DataStoreMoveSave.Saved;
    }

    public async Task<bool> TrySaveAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return false;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.ChangeTracker.Clear();
            return false;
        }
    }
}
