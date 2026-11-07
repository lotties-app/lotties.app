namespace Lotties.Infrastructure.Stores;

/// <summary>
/// The routing half of configuration section <c>Stores</c> (docs/design/47-bring-your-own-database.md section 12): the same
/// section and the same <c>Stores:Enabled</c> flag as the sealed store credentials (task T3), bound separately. Off by default:
/// every baby is on the built-in store at epoch 0 and the resolver reads nothing, so hosted requests run exactly the queries
/// they ran before. On: each baby's row decides (<c>babies.data_store_id</c>, <c>babies.store_epoch</c>), one query per baby
/// per request.
/// </summary>
/// <remarks>
/// Turn the flag off only while no baby points at an external store: with it off a pointer is not read, so such a baby would be
/// served from the built-in database. Nothing sets a pointer yet (the endpoints that move a baby are task T6 and require the
/// flag).
/// </remarks>
public sealed class StoreRoutingOptions
{
    public const string SectionName = "Stores";

    /// <summary>The feature flag of bring-your-own-database; false by default.</summary>
    public bool Enabled { get; set; }
}
