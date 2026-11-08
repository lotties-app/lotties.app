namespace Lotties.Domain.Stores;

/// <summary>
/// Persistence of <see cref="DataStoreMove"/> rows (control plane, <c>data_store_moves</c>, one per baby; task T7). Saves are
/// optimistic: the row's version decides a race between two workers or between a worker and the owner starting a new move.
/// </summary>
public interface IDataStoreMoveRepository
{
    /// <summary>The baby's move, tracked; <c>null</c> when the baby never moved.</summary>
    Task<DataStoreMove?> FindAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Whether a move of the baby blocks its writes at <paramref name="now"/> (<see cref="DataStoreMove.BlocksWrites"/>), read without tracking.</summary>
    Task<bool> BlocksWritesAsync(Guid babyId, DateTimeOffset now, CancellationToken cancellationToken = default);

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
}
