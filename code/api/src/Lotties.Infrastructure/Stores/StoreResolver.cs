using Lotties.Application.Stores;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores;

/// <remarks>
/// With <see cref="StoreRoutingOptions.Enabled"/> off nothing is read (every baby: built-in, epoch 0). With it on, one query of
/// the two routing columns of the baby's row through the control context; a baby without a row (never created, or erased) has
/// no pointer, so it is on the built-in store, where it has no records either.
/// </remarks>
internal sealed class StoreResolver(IOptions<StoreRoutingOptions> options, LottiesDbContext control) : IStoreResolver
{
    public async Task<StoreRoute> ResolveForBabyAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        if (!options.Value.Enabled)
        {
            return StoreRoute.BuiltInDefault;
        }

        var routing = await control.BabyStoreAssignments
            .AsNoTracking()
            .Where(assignment => assignment.BabyId == babyId)
            .Select(assignment => new { assignment.DataStoreId, assignment.Epoch })
            .SingleOrDefaultAsync(cancellationToken);
        return routing is null ? StoreRoute.BuiltInDefault : new StoreRoute(DataStoreKey.Of(routing.DataStoreId), routing.Epoch);
    }
}
