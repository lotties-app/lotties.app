namespace Lotties.Application.Stores;

/// <summary>
/// The row a sealed descriptor belongs to: the store id and the account that owns the store
/// (docs/design/47-bring-your-own-database.md D1 and section 3.3). Both go into the associated data of the seal, with the
/// format version, so a blob copied to another row (another store or another owner) fails to open.
/// </summary>
public sealed record StoreSealContext
{
    public StoreSealContext(Guid storeId, Guid ownerId)
    {
        StoreId = storeId != Guid.Empty ? storeId : throw new ArgumentException("A store id is required.", nameof(storeId));
        OwnerId = ownerId != Guid.Empty ? ownerId : throw new ArgumentException("An owner id is required.", nameof(ownerId));
    }

    public Guid StoreId { get; }

    /// <summary>The account (user id) that owns the store.</summary>
    public Guid OwnerId { get; }
}
