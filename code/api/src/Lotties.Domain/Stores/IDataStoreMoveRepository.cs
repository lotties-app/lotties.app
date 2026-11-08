namespace Lotties.Domain.Stores;

/// <summary>
/// Persistence of <see cref="DataStoreMove"/> rows (control plane, <c>data_store_moves</c>, one per baby; task T7). Saves are
/// optimistic: the row's version decides a race between two workers or between a worker and the owner starting a new move.
/// </summary>
public interface IDataStoreMoveRepository
{
    /// <summary>The baby's move, tracked; <c>null</c> when the baby never moved.</summary>
    Task<DataStoreMove?> FindAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Whether the baby's writes are refused at <paramref name="now"/>, read without tracking: its account is being deleted
    /// (<see cref="AccountDeletionBlock"/>, task T10) or a move blocks them (<see cref="DataStoreMove.BlocksWrites"/>).
    /// </summary>
    Task<StoreWriteBlock> WriteBlockAsync(Guid babyId, DateTimeOffset now, CancellationToken cancellationToken = default);

    /// <summary>
    /// The babies whose move may have work due at <paramref name="now"/> (no worker holds the row, and it is in progress, past its
    /// cleanup time or has leftovers), oldest change first, at most <paramref name="limit"/>.
    /// </summary>
    Task<IReadOnlyList<Guid>> ListDueAsync(DateTimeOffset now, int limit, CancellationToken cancellationToken = default);

    /// <summary>Adds a new row (saved by the next <see cref="TrySaveAsync"/>).</summary>
    void Add(DataStoreMove move);

    /// <summary>
    /// Saves every tracked change of the control plane in one transaction (a move and the baby's store pointer switch together).
    /// Returns <c>false</c>, with nothing saved and nothing tracked any more, when a concurrent writer changed one of the rows first
    /// or added the same baby's row.
    /// </summary>
    Task<bool> TrySaveAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Like <see cref="TrySaveAsync"/> for a save that starts or resumes work on the baby's records (a new move, a worker's claim), in
    /// one transaction that first takes the baby's row with a conditional update that matches only while no account deletion blocks it
    /// (<see cref="AccountDeletionBlock"/>). The account eraser sets that block with the mirror update and then looks for a running move,
    /// so of a move start and a deletion that race, exactly one goes ahead. Nothing is saved or tracked any more unless it returns
    /// <see cref="DataStoreMoveSave.Saved"/>.
    /// </summary>
    Task<DataStoreMoveSave> TrySaveUnlessDeletingAsync(Guid babyId, DateTimeOffset now, CancellationToken cancellationToken = default);
}
