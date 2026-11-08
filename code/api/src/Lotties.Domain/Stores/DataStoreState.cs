namespace Lotties.Domain.Stores;

/// <summary>
/// The life cycle of an external data store (docs/design/47-bring-your-own-database.md section 4). Only
/// <see cref="Ready"/> serves requests; the migrator (task T5) and the failure handling (task T8) move a store between
/// the others (<see cref="DataStoreStateTransitions"/>). Stored by name in <c>data_stores.state</c> (at most 32 characters) and,
/// once the store has its schema, in <c>lotties.store_meta.state</c> of the store itself.
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

    /// <summary>
    /// The app role can do more than read and write the data tables (superuser-like, owns objects, may create in <c>public</c>
    /// or in <c>lotties</c>): refused until the owner fixes the role (docs/design/47-bring-your-own-database.md section 3.3).
    /// </summary>
    RoleTooPowerful,

    /// <summary>
    /// The database holds what Lotties did not create for this store: the control tables of a Lotties database, or a schema set up
    /// for another store. Never migrated, never served.
    /// </summary>
    SchemaConflict,
}
