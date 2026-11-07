namespace Lotties.Domain.Stores;

/// <summary>
/// The life cycle of an external data store (docs/design/47-bring-your-own-database.md section 4). Only
/// <see cref="Ready"/> serves requests; the migrator (task T5) and the failure handling (task T8) move a store between
/// the others. Stored by name in <c>data_stores.state</c>.
/// </summary>
public enum DataStoreState
{
    /// <summary>Created, never connected.</summary>
    Pending,

    /// <summary>The data schema is being applied.</summary>
    Migrating,

    /// <summary>Serves requests.</summary>
    Ready,

    /// <summary>The last migration failed; retried with backoff.</summary>
    MigrationFailed,

    /// <summary>The store holds a newer schema than this API knows (a rolled-back release).</summary>
    SchemaAhead,

    /// <summary>The last connection failed (down, paused, wrong credentials).</summary>
    Unreachable,

    /// <summary>Stopped on purpose (kill switch); nothing uses it.</summary>
    Disabled,
}
