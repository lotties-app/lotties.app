using Lotties.Domain.Stores;

namespace Lotties.Application.Stores;

/// <summary>
/// Finds where a baby's records are (docs/design/47-bring-your-own-database.md section 2.1). The input is always a baby id the
/// caller was already authorized for, never a store id from a client. With <c>Stores:Enabled</c> off (the default) every baby is
/// on the built-in store at epoch 0 and nothing is read; with it on, the baby's row (<c>babies.data_store_id</c>,
/// <c>babies.store_epoch</c>) decides.
/// </summary>
public interface IStoreResolver
{
    Task<StoreRoute> ResolveForBabyAsync(Guid babyId, CancellationToken cancellationToken = default);
}
