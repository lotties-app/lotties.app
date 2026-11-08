using Lotties.Domain.Common;

namespace Lotties.Domain.Stores;

/// <summary>
/// A baby's pointer to its data store and its store epoch (docs/design/47-bring-your-own-database.md sections 2.1 and 2.3):
/// the columns <c>babies.data_store_id</c> (null = the built-in store) and <c>babies.store_epoch</c> of the baby's own row,
/// mapped beside <c>Baby</c> so that every query of a baby reads exactly the columns it read before. Every baby row has
/// one; a baby that never moved points at the built-in store with epoch 0.
/// </summary>
public sealed class BabyStoreAssignment
{
    private BabyStoreAssignment()
    {
    }

    public Guid BabyId { get; private set; }

    /// <summary>The external store holding the baby's records, or <c>null</c> for the built-in store.</summary>
    public Guid? DataStoreId { get; private set; }

    /// <summary>Changes with every move to another store; never goes back.</summary>
    public int Epoch { get; private set; }

    /// <summary>
    /// When the deletion of the account that alone keeps the baby started (<see cref="AccountDeletionBlock"/>, task T10), else
    /// <c>null</c>. Set and cleared by conditional updates of the account eraser, never through this entity.
    /// </summary>
    public DateTimeOffset? AccountDeletionStartedAt { get; private set; }

    public DataStoreKey Store => DataStoreKey.Of(DataStoreId);

    public StoreRoute Route => new(Store, Epoch);

    /// <summary>What every new baby row holds (the database defaults): the built-in store at epoch 0.</summary>
    public static BabyStoreAssignment ForNewBaby(Guid babyId) => new() { BabyId = Ids.Required(babyId, nameof(babyId)) };

    /// <summary>
    /// Points the baby at <paramref name="store"/> and moves the epoch on, so clients holding the old epoch pull everything
    /// again. The store it already points at changes nothing; returns whether it moved.
    /// </summary>
    public bool MoveTo(DataStoreKey store)
    {
        if (store == Store)
        {
            return false;
        }

        DataStoreId = store.Id;
        Epoch = checked(Epoch + 1);
        return true;
    }
}
