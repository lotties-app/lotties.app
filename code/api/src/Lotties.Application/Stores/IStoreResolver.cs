using Lotties.Domain.Stores;

namespace Lotties.Application.Stores;

/// <summary>
/// Finds where a baby's records are (docs/design/47-bring-your-own-database.md section 2.1). The input is always a baby id the
/// caller was already authorized for, never a store id from a client. The baby's row (<c>babies.data_store_id</c>,
/// <c>babies.store_epoch</c>) always decides, whatever <c>Stores:Enabled</c> says: the flag only governs whether an external store
/// may be opened, never whether the pointer is read.
/// </summary>
public interface IStoreResolver
{
    Task<StoreRoute> ResolveForBabyAsync(Guid babyId, CancellationToken cancellationToken = default);
}
