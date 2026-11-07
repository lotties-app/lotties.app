using Lotties.Application.Stores;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Stores;

/// <remarks>
/// Always one query of the two routing columns of the baby's row through the control context, whatever <c>Stores:Enabled</c> says:
/// a baby that points at an external store must never be served from the built-in database, so the pointer is read even while no
/// external store can be opened (<see cref="StoreScope"/> then answers <c>store_unavailable</c>). A baby without a row (never
/// created, or erased) has no pointer, so it is on the built-in store, where it has no records either.
/// </remarks>
internal sealed class StoreResolver(LottiesDbContext control) : IStoreResolver
{
    public async Task<StoreRoute> ResolveForBabyAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var routing = await control.BabyStoreAssignments
            .AsNoTracking()
            .Where(assignment => assignment.BabyId == babyId)
            .Select(assignment => new { assignment.DataStoreId, assignment.Epoch })
            .SingleOrDefaultAsync(cancellationToken);
        return routing is null ? StoreRoute.BuiltInDefault : new StoreRoute(DataStoreKey.Of(routing.DataStoreId), routing.Epoch);
    }
}
