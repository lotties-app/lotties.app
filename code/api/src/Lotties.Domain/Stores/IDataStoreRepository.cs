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

    /// <summary>Whether any baby points at <paramref name="storeId"/>.</summary>
    Task<bool> IsInUseAsync(Guid storeId, CancellationToken cancellationToken = default);

    /// <summary>Adds a new store (saved by the next <see cref="SaveChangesAsync"/>).</summary>
    void Add(DataStore store);

    /// <summary>Removes the row (saved by the next <see cref="SaveChangesAsync"/>).</summary>
    void Remove(DataStore store);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
