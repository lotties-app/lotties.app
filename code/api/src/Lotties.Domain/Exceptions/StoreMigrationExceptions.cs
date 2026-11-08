using Lotties.Domain.Stores;

namespace Lotties.Domain.Exceptions;

/// <summary>
/// The baby's store is being migrated by another request or another API instance and did not finish within the wait
/// (docs/design/47-bring-your-own-database.md section 4): 503, retriable; the client keeps the change queued.
/// </summary>
public sealed class StoreMigratingException : StoreFailureException
{
    public StoreMigratingException(TimeSpan? retryAfter = null)
        : base(StoreFailureClass.Migrating, "The database that holds this baby's records is being updated. Try again in a moment.", retryAfter)
    {
    }
}

/// <summary>
/// The baby's store holds a newer data schema than this API knows (a release was rolled back): refused, never served, because
/// the code must not read or write a schema it does not know (503 until a newer API runs).
/// </summary>
public sealed class StoreSchemaAheadException : StoreFailureException
{
    public StoreSchemaAheadException(TimeSpan? retryAfter = null)
        : base(StoreFailureClass.SchemaAhead, "The database that holds this baby's records was updated by a newer version of Lotties.", retryAfter)
    {
    }
}

/// <summary>
/// The app role of the baby's store can do more than read and write the data tables (docs/design/47-bring-your-own-database.md
/// section 3.3): the store is refused until the owner fixes the role (503). <see cref="Findings"/> are machine codes only.
/// </summary>
public sealed class StoreRoleTooPowerfulException : StoreFailureException
{
    public StoreRoleTooPowerfulException(IReadOnlyList<StoreRoleFinding> findings, TimeSpan? retryAfter = null)
        : base(StoreFailureClass.RoleTooPowerful, "The database role Lotties uses for this baby's records has more rights than it should.", retryAfter)
    {
        Findings = findings;
    }

    public IReadOnlyList<StoreRoleFinding> Findings { get; }
}

/// <summary>
/// The baby's store holds something Lotties did not create or that belongs to another store: the control tables of a Lotties
/// database, or a schema set up for another store (503). Never migrated, never served.
/// </summary>
public sealed class StoreSchemaConflictException : StoreFailureException
{
    public StoreSchemaConflictException(TimeSpan? retryAfter = null)
        : base(StoreFailureClass.SchemaConflict, "The database for this baby's records holds data Lotties did not expect.", retryAfter)
    {
    }
}

/// <summary>
/// Applying the data schema to the baby's store failed (the migration rolled back); retried with backoff (503, retriable). The
/// message never carries the database's own text.
/// </summary>
public sealed class StoreMigrationFailedException : StoreFailureException
{
    public StoreMigrationFailedException(TimeSpan? retryAfter = null)
        : base(StoreFailureClass.MigrationFailed, "The database that holds this baby's records could not be updated. Try again later.", retryAfter)
    {
    }
}

/// <summary>
/// A move between store states that <see cref="DataStoreStateTransitions"/> does not allow (500, a programming error, or a store
/// that was disabled while it was being checked).
/// </summary>
public sealed class DataStoreStateTransitionException : DomainException
{
    public DataStoreStateTransitionException(DataStoreState from, DataStoreState to)
        : base("store_state_transition", $"A data store cannot move from {from} to {to}.")
    {
        From = from;
        To = to;
    }

    public DataStoreState From { get; }

    public DataStoreState To { get; }
}
