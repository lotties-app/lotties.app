namespace Lotties.Domain.Stores;

/// <summary>
/// Which <see cref="DataStoreState"/> a store may move to (docs/design/47-bring-your-own-database.md section 4). A store starts
/// <see cref="DataStoreState.Pending"/> and never returns there; <see cref="DataStoreState.Ready"/> is reached only through a
/// migration run (<see cref="DataStoreState.Migrating"/>) or from a check that found nothing to apply; a
/// <see cref="DataStoreState.Disabled"/> store is left alone by the migrator (only the owner's or the operator's action, task T6,
/// turns it back on). Recording the state a store already has is always allowed (a repeated check).
/// </summary>
public static class DataStoreStateTransitions
{
    /// <summary>Whether a store in <paramref name="from"/> may be recorded as <paramref name="to"/> by the migrator.</summary>
    public static bool CanMove(DataStoreState from, DataStoreState to) =>
        from == to || (from != DataStoreState.Disabled && to is not (DataStoreState.Pending or DataStoreState.Disabled));

    /// <summary>Whether a store in <paramref name="state"/> serves requests: only <see cref="DataStoreState.Ready"/>.</summary>
    public static bool Serves(DataStoreState state) => state == DataStoreState.Ready;
}
