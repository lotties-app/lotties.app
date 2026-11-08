namespace Lotties.Infrastructure.Stores;

/// <summary>
/// The routing half of configuration section <c>Stores</c> (docs/design/47-bring-your-own-database.md section 12): the same
/// section and the same <c>Stores:Enabled</c> flag as the sealed store credentials (task T3), bound separately. Off by default:
/// no external store is ever opened (nor, with later tasks, created or connected). The baby's store pointer is read on every
/// request whatever the flag says (one query per baby per request), so a baby that points at an external store gets
/// <c>store_unavailable</c> while the flag is off and is never served from the built-in database; every other baby is on the
/// built-in store.
/// </summary>
public sealed class StoreRoutingOptions
{
    public const string SectionName = "Stores";

    /// <summary>The feature flag of bring-your-own-database; false by default.</summary>
    public bool Enabled { get; set; }
}
