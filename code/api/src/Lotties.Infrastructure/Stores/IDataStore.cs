using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// One data store (docs/design/47-bring-your-own-database.md section 2.1): its identity and kind (<see cref="Key"/>) and the
/// data-plane contexts on it. There are two kinds and one code path: the built-in store is the Lotties database, every other store
/// is a database a family brings. Lives in Infrastructure because it hands out EF contexts; the application sees stores only
/// through <c>IStoreScope</c> and <c>StoreRoute</c>.
/// </summary>
public interface IDataStore
{
    DataStoreKey Key { get; }

    /// <summary>
    /// A data context on this store. The built-in store hands out the scope's own <see cref="LottiesDataDbContext"/>, on the control
    /// context's connection and owned by the DI scope; an external store creates a new context with options of its own (never a
    /// pooled context: options differ per store), which the <c>StoreScope</c> that asked for it disposes.
    /// </summary>
    LottiesDataDbContext CreateContext();
}
