namespace Lotties.Domain.Stores;

/// <summary>
/// Which store a database says it belongs to, read from its <c>lotties.store_meta</c> row (written by the migrator when the store
/// first became ready: docs/design/47-bring-your-own-database.md section 4) through each endpoint of a connection descriptor:
/// <see cref="MigratorSees"/> on the migrator's direct endpoint, <see cref="AppSees"/> on the app endpoint the requests use.
/// <c>null</c> when that database has no <c>store_meta</c> row (an empty database, a Lotties control database, anything else).
/// </summary>
public sealed record StoreDatabaseIdentity(Guid? MigratorSees, Guid? AppSees)
{
    /// <summary>What an empty database (or one Lotties never set up) answers.</summary>
    public static StoreDatabaseIdentity None { get; } = new(null, null);

    /// <summary>
    /// Whether both endpoints reach a database set up for <paramref name="storeId"/>: the rule for new connection details of a store
    /// that holds a baby's records (a new password, user or host of the same database). An unknown identity is never the same database.
    /// </summary>
    public bool IsOf(Guid storeId) => storeId != Guid.Empty && MigratorSees == storeId && AppSees == storeId;
}
