namespace Lotties.Domain.Stores;

/// <summary>
/// The identity of a data store: the built-in store (no id; <c>babies.data_store_id</c> is null) or an external store by
/// its <c>data_stores</c> id (docs/design/47-bring-your-own-database.md section 2.1). A store id never comes from a client:
/// it is read from the baby's row after the caller was authorized for the baby.
/// </summary>
public readonly record struct DataStoreKey
{
    private DataStoreKey(Guid? id)
    {
        Id = id;
    }

    /// <summary>The Lotties database.</summary>
    public static DataStoreKey BuiltIn { get; } = new(null);

    /// <summary>The <c>data_stores</c> id of an external store; <c>null</c> for the built-in store.</summary>
    public Guid? Id { get; }

    public DataStoreKind Kind => Id is null ? DataStoreKind.BuiltIn : DataStoreKind.External;

    /// <summary>An external store; throws <see cref="ArgumentException"/> for an empty id.</summary>
    public static DataStoreKey External(Guid id) =>
        id != Guid.Empty ? new DataStoreKey(id) : throw new ArgumentException("An external store needs an id.", nameof(id));

    /// <summary>The store a <c>babies.data_store_id</c> value names: null is the built-in store.</summary>
    public static DataStoreKey Of(Guid? id) => id is { } value ? External(value) : BuiltIn;

    public override string ToString() => Id is { } id ? $"external:{id:N}" : "built-in";
}
