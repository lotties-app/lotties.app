namespace Lotties.Domain.Stores;

/// <summary>
/// Persistence of <see cref="DataStore"/> rows and the babies' pointers to them (control plane; docs/design/47-bring-your-own-database.md
/// task T6). One store per account (D11): the owner's row is found by her account id.
/// </summary>
public interface IDataStoreRepository
{
    /// <summary>The store owned by <paramref name="ownerUserId"/> (her oldest, should there be more), tracked; <c>null</c> when she has none.</summary>
    Task<DataStore?> FindByOwnerAsync(Guid ownerUserId, CancellationToken cancellationToken = default);

    /// <summary>The store <paramref name="storeId"/>, tracked; <c>null</c> when it is gone.</summary>
    Task<DataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default);

    /// <summary>The store the baby's records are in (<c>babies.data_store_id</c>), or <c>null</c> for the built-in store.</summary>
    Task<Guid?> StoreOfBabyAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The baby's store pointer and epoch, tracked so a move can switch it (task T7, saved with the move in one transaction);
    /// <c>null</c> when the baby has no row.
    /// </summary>
    Task<BabyStoreAssignment?> FindAssignmentAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Whether any baby points at <paramref name="storeId"/>.</summary>
    Task<bool> IsInUseAsync(Guid storeId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Adds a store in one save. Returns <c>false</c>, leaving nothing tracked, when a row with its id exists already (a concurrent
    /// first save of the same owner, whose store id is derived from her: <see cref="DataStore.FirstStoreIdOf"/>).
    /// </summary>
    Task<bool> TryAddAsync(DataStore store, CancellationToken cancellationToken = default);

    /// <summary>Removes the row (saved by the next <see cref="SaveChangesAsync"/>).</summary>
    void Remove(DataStore store);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
