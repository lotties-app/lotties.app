namespace Lotties.Domain.Stores;

/// <summary>
/// Where one baby's records are, as resolved for a request or a job: the store and the baby's store epoch
/// (docs/design/47-bring-your-own-database.md section 2.3). The epoch is a per-baby counter that changes every time the
/// baby moves to another store; sync responses carry it so a client holding another value discards its cursors and pulls
/// everything again. A baby that never moved is on the built-in store with epoch 0.
/// </summary>
public sealed record StoreRoute
{
    public StoreRoute(DataStoreKey store, int epoch)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(epoch);
        Store = store;
        Epoch = epoch;
    }

    /// <summary>The built-in store at epoch 0: every baby that never moved.</summary>
    public static StoreRoute BuiltInDefault { get; } = new(DataStoreKey.BuiltIn, 0);

    public DataStoreKey Store { get; }

    public int Epoch { get; }
}
