using Lotties.Domain.CareProviders;
using Lotties.Infrastructure.Persistence.Errors;
using Lotties.Infrastructure.Stores;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety of <see cref="TryAddAsync"/> relies on the primary key: a concurrent insert of the same id fails with a
/// unique violation, the rejected entity is detached and <c>false</c> is returned. Any other database error is logged and rethrown.
/// </remarks>
internal sealed class EfCareProviderRepository(StoreScope stores, UniqueViolations uniqueViolations, ILogger<EfCareProviderRepository> logger) : ICareProviderRepository
{
    public Task<CareProvider?> FindAsync(Guid providerId, CancellationToken cancellationToken = default) =>
        stores.Current.CareProviders.SingleOrDefaultAsync(provider => provider.Id == providerId, cancellationToken);

    public async Task<IReadOnlyList<CareProvider>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var from = since?.ToUniversalTime();
        return await stores.ContextFor(babyId).CareProviders
            .AsNoTracking()
            .Where(provider => provider.BabyId == babyId && (from == null || provider.UpdatedAt >= from))
            .OrderBy(provider => provider.UpdatedAt)
            .ThenBy(provider => provider.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> TryAddAsync(CareProvider provider, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(provider);
        var context = stores.ContextFor(provider.BabyId);
        try
        {
            context.CareProviders.Add(provider);
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.Entry(provider).State = EntityState.Detached;
            return false;
        }
        catch (DbUpdateException exception)
        {
            context.Entry(provider).State = EntityState.Detached;
            logger.LogError(exception, "Saving new care provider {ProviderId} failed with a database error that is not a unique violation", provider.Id);
            throw;
        }
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => stores.Current.SaveChangesAsync(cancellationToken);
}
