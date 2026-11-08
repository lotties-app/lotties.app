using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Stores;

/// <summary>
/// An external data store (<c>data_stores</c>, control plane; docs/design/47-bring-your-own-database.md D1 and D11): owned by an
/// account (the Owner of the babies that point at it through <c>babies.data_store_id</c>), with its state and the sealed
/// connection descriptor (task T3 seals it; nothing in this row is readable as a connection string). The built-in store has
/// no row. The owner creates it with <c>PUT /babies/{babyId}/data-store</c> (task T6, only while <c>Stores:Enabled</c> is on and the
/// account is on the allowlist); one store per account in the MVP (the routes reuse the owner's store).
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

    /// <summary>
    /// The provider label of the saved descriptor (display only, the one field of the descriptor kept readable: docs/design/47
    /// section 3.3), or <c>null</c> before the owner saved one.
    /// </summary>
    public string? ProviderLabel { get; private set; }

    /// <summary>When the owner last ran "Test connection" on the saved descriptor (task T6); <c>null</c> when never, or since it was replaced.</summary>
    public DateTimeOffset? LastCheckedAt { get; private set; }

    /// <summary>The coarse result code of that test (<c>ok</c> or a <c>store_*</c>/<c>endpoint_*</c> code, never server text).</summary>
    public string? LastCheckResult { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>Whether the owner saved a descriptor.</summary>
    public bool HasDescriptor => SealedDescriptor is not null;

    /// <summary>Namespace of derived store ids. Never change it: existing first stores would no longer be found by their id.</summary>
    public static readonly Guid IdNamespace = new("b7c1e0d4-5a2f-4c39-9e81-3f6d2a7b9c05");

    /// <summary>
    /// The id of an account's first store (UUID v5 of the owner): two simultaneous first saves of one owner create the same row, so
    /// the primary key lets only one of them in (one store per account in the MVP, D11) without a unique index on the owner that
    /// would forbid per-baby stores later.
    /// </summary>
    public static Guid FirstStoreIdOf(Guid ownerUserId) =>
        DeterministicGuid.Create(IdNamespace, $"first-store|{Ids.Required(ownerUserId, nameof(ownerUserId)):N}");

    /// <summary>A new store of <paramref name="ownerUserId"/>, <see cref="DataStoreState.Pending"/> and without a descriptor.</summary>
    public static DataStore Create(Guid id, Guid ownerUserId, DateTimeOffset now) =>
        new(Ids.Required(id, nameof(id)), Ids.Required(ownerUserId, nameof(ownerUserId)), UtcTime.Normalize(now));

    /// <summary>
    /// Saves a new or replacement descriptor (the owner's <c>PUT</c>, task T6): the store goes back to
    /// <see cref="DataStoreState.Pending"/> because nothing has checked the new credentials yet, and the last test result is
    /// forgotten. A <see cref="DataStoreState.Disabled"/> store stays disabled: the kill switch is the operator's, never undone by
    /// the owner's save.
    /// </summary>
    public void ReplaceDescriptor(SealedDescriptor descriptor, string providerLabel, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        ArgumentException.ThrowIfNullOrWhiteSpace(providerLabel);
        SealedDescriptor = descriptor.ToArray();
        ProviderLabel = providerLabel;
        State = State == DataStoreState.Disabled ? DataStoreState.Disabled : DataStoreState.Pending;
        LastCheckedAt = null;
        LastCheckResult = null;
        UpdatedAt = UtcTime.Normalize(now);
    }

    /// <summary>
    /// A copy of this store carrying <paramref name="descriptor"/> instead of the saved one (same id and owner, so it opens with the
    /// same seal context): what new connection details would connect to, for a read-only check before they replace the saved ones.
    /// Never saved or tracked; this row is left as it is.
    /// </summary>
    public DataStore WithCandidateDescriptor(SealedDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        return new DataStore(Id, OwnerUserId, CreatedAt) { State = State, SchemaVersion = SchemaVersion, SealedDescriptor = descriptor.ToArray() };
    }

    /// <summary>Records the coarse outcome of the owner's connection test; the state is the migrator's and stays as it is.</summary>
    public void RecordCheck(string resultCode, DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(resultCode);
        LastCheckedAt = UtcTime.Normalize(now);
        LastCheckResult = resultCode;
        UpdatedAt = LastCheckedAt.Value;
    }

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
