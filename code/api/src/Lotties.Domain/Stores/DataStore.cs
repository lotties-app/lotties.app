using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Stores;

/// <summary>
/// An external data store (<c>data_stores</c>, control plane; docs/design/47-bring-your-own-database.md D1 and D11): owned by an
/// account (the Owner of the babies that point at it through <c>babies.data_store_id</c>), with its state and the sealed
/// connection descriptor (task T3 seals it; nothing in this row is readable as a connection string). The built-in store has
/// no row. Today no code creates one outside tests: the table stays empty until the bring-your-own-database endpoints exist
/// (task T6) and <c>Stores:Enabled</c> is on.
/// </summary>
public sealed class DataStore
{
    private DataStore()
    {
    }

    private DataStore(Guid id, Guid ownerUserId, DateTimeOffset now)
    {
        Id = id;
        OwnerUserId = ownerUserId;
        State = DataStoreState.Pending;
        CreatedAt = now;
        UpdatedAt = now;
    }

    public Guid Id { get; private set; }

    /// <summary>The account that owns the store; deleting the account deletes the row (<c>AccountErasureTests.Rules</c>).</summary>
    public Guid OwnerUserId { get; private set; }

    public DataStoreState State { get; private set; }

    /// <summary>The sealed connection descriptor (task T3), or <c>null</c> before the owner saved one. Never logged or returned.</summary>
    public byte[]? SealedDescriptor { get; private set; }

    /// <summary>
    /// The last data migration the migrator found applied in the store (task T5; a migration id of the data chain), or
    /// <c>null</c> before the first run. A mirror of <c>lotties.store_meta.schema_version</c> in the store.
    /// </summary>
    public string? SchemaVersion { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>A new store of <paramref name="ownerUserId"/>, <see cref="DataStoreState.Pending"/> and without a descriptor.</summary>
    public static DataStore Create(Guid id, Guid ownerUserId, DateTimeOffset now) =>
        new(Ids.Required(id, nameof(id)), Ids.Required(ownerUserId, nameof(ownerUserId)), UtcTime.Normalize(now));

    /// <summary>
    /// Records what the migrator found (task T5): the new state and, when known, the schema version of the store. Throws
    /// <see cref="DataStoreStateTransitionException"/> for a move <see cref="DataStoreStateTransitions"/> does not allow; a null
    /// <paramref name="schemaVersion"/> keeps the stored one.
    /// </summary>
    public void RecordMigrationState(DataStoreState state, string? schemaVersion, DateTimeOffset now)
    {
        if (!DataStoreStateTransitions.CanMove(State, state))
        {
            throw new DataStoreStateTransitionException(State, state);
        }

        State = state;
        SchemaVersion = schemaVersion ?? SchemaVersion;
        UpdatedAt = UtcTime.Normalize(now);
    }
}
