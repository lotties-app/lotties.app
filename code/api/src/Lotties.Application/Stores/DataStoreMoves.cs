using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Stores;

/// <summary>
/// The request side of a move (task T7): the checks before a move may start, the start itself (the move row blocks the baby's writes
/// from the moment it is saved) and the hand-off to this process's worker. Used by <see cref="DataStoreService"/>.
/// </summary>
internal sealed class DataStoreMoves(
    IDataStoreMoveRepository moves,
    IBabyRepository babies,
    IInviteRepository invites,
    IStoreMigrator migrator,
    IStoreMoveQueue queue,
    StoreMoveWorkerId worker,
    StoreMoveOptions options,
    TimeProvider time,
    ILogger<DataStoreMoves> logger)
{
    /// <summary>The baby's latest move as the owner sees it, or <c>null</c> when it never moved.</summary>
    public async Task<DataStoreMoveStatus?> StatusAsync(Guid babyId, CancellationToken cancellationToken) =>
        await moves.FindAsync(babyId, cancellationToken) is { } move ? DataStoreViews.Move(move, time.GetUtcNow()) : null;

    /// <summary>
    /// Into the owner's store <paramref name="store"/>: the baby must still be hosted (<c>store_move_not_needed</c>), kept by its Owner
    /// alone (<c>store_owner_only</c>, D11: no other member of any role, doctors included, and no pending invite, which task T11 would
    /// refuse to accept afterwards) and the store ready (the migrator brings its schema up to date and audits the app role first; a store
    /// that is down or set up wrongly answers its <c>store_*</c> error).
    /// </summary>
    public async Task<DataStoreMoveStatus> StartInAsync(Guid babyId, Guid? pointer, DataStore store, User owner, CancellationToken cancellationToken)
    {
        EnsureHosted(pointer);
        await EnsureOwnerAloneAsync(babyId, owner, cancellationToken);
        await migrator.EnsureReadyAsync(store.Id, cancellationToken);
        return await StartAsync(babyId, DataStoreMoveDirection.In, store.Id, cancellationToken);
    }

    /// <summary>Back to Lotties' database: the baby must point at the owner's store, which must be readable (ready).</summary>
    public async Task<DataStoreMoveStatus> StartOutAsync(Guid babyId, Guid? pointer, CancellationToken cancellationToken)
    {
        var storeId = pointer ?? throw new DataStoreMoveNotNeededException();
        await migrator.EnsureReadyAsync(storeId, cancellationToken);
        return await StartAsync(babyId, DataStoreMoveDirection.Out, storeId, cancellationToken);
    }

    private static void EnsureHosted(Guid? pointer)
    {
        if (pointer is not null)
        {
            throw new DataStoreMoveNotNeededException();
        }
    }

    private async Task EnsureOwnerAloneAsync(Guid babyId, User owner, CancellationToken cancellationToken)
    {
        var baby = await babies.FindAsync(babyId, cancellationToken) ?? throw new BabyNotFoundException(babyId);
        var pending = await invites.ListPendingAsync(babyId, time.GetUtcNow(), cancellationToken);
        if (baby.Members.Any(member => member.UserId != owner.Id) || pending.Count > 0)
        {
            throw new StoreOwnerOnlyException(babyId);
        }
    }

    /// <summary>
    /// Saves the move (new, or replacing the baby's earlier one), which blocks the baby's writes from now on, then hands it to this
    /// process's worker. A start that races another start or a worker on the same row loses (<c>store_move_in_progress</c>).
    /// </summary>
    private async Task<DataStoreMoveStatus> StartAsync(Guid babyId, DataStoreMoveDirection direction, Guid ownStoreId, CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var move = await moves.FindAsync(babyId, cancellationToken);
        if (move is null)
        {
            move = DataStoreMove.Start(babyId, direction, ownStoreId, worker.Value, now, options.Lease);
            moves.Add(move);
        }
        else
        {
            move.Restart(direction, ownStoreId, worker.Value, now, options.Lease);
        }

        if (!await moves.TrySaveAsync(cancellationToken))
        {
            throw new DataStoreMoveInProgressException();
        }

        queue.Enqueue(babyId);
        logger.LogInformation("Started a move of a baby's records ({Direction})", direction);
        return DataStoreViews.Move(move, now);
    }
}
