using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// <c>data_stores</c> and the babies' pointers (<c>babies.data_store_id</c>) on the control context (task T6). The primary key decides
/// two concurrent first saves of one owner (<see cref="TryAddAsync"/>; the id is derived from the owner).
/// </remarks>
internal sealed class EfDataStoreRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : IDataStoreRepository
{
    public Task<DataStore?> FindByOwnerAsync(Guid ownerUserId, CancellationToken cancellationToken = default) =>
        context.DataStores
            .Where(store => store.OwnerUserId == ownerUserId)
            .OrderBy(store => store.CreatedAt)
            .ThenBy(store => store.Id)
            .FirstOrDefaultAsync(cancellationToken);

    public Task<DataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default) =>
        context.DataStores.SingleOrDefaultAsync(store => store.Id == storeId, cancellationToken);

    public Task<Guid?> StoreOfBabyAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        context.BabyStoreAssignments.AsNoTracking()
            .Where(assignment => assignment.BabyId == babyId)
            .Select(assignment => assignment.DataStoreId)
            .SingleOrDefaultAsync(cancellationToken);

    public Task<bool> IsInUseAsync(Guid storeId, CancellationToken cancellationToken = default) =>
        context.BabyStoreAssignments.AsNoTracking().AnyAsync(assignment => assignment.DataStoreId == storeId, cancellationToken);

    public async Task<bool> TryAddAsync(DataStore store, CancellationToken cancellationToken = default)
    {
        context.DataStores.Add(store);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.Entry(store).State = EntityState.Detached;
            return false;
        }
        catch (DbUpdateException)
        {
            context.Entry(store).State = EntityState.Detached;
            throw;
        }
    }

    public void Remove(DataStore store) => context.DataStores.Remove(store);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
