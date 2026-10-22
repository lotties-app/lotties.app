using Lotties.Domain.Vaccinations;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety of <see cref="TryAddAsync"/> relies on the primary key: a concurrent insert of the same id fails with a
/// unique violation, the rejected entity is detached and <c>false</c> is returned. Any other database error is logged and rethrown.
/// </remarks>
internal sealed class EfVaccinationRepository(LottiesDbContext context, UniqueViolations uniqueViolations, ILogger<EfVaccinationRepository> logger) : IVaccinationRepository
{
    public Task<Vaccination?> FindAsync(Guid vaccinationId, CancellationToken cancellationToken = default) =>
        context.Vaccinations.SingleOrDefaultAsync(vaccination => vaccination.Id == vaccinationId, cancellationToken);

    public async Task<IReadOnlyList<Vaccination>> ListAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var ofBaby = context.Vaccinations.AsNoTracking().Where(vaccination => vaccination.BabyId == babyId);
        if (since is null)
        {
            return await ofBaby.OrderBy(vaccination => vaccination.GivenOn).ThenBy(vaccination => vaccination.Id).ToListAsync(cancellationToken);
        }

        var from = since.Value.ToUniversalTime();
        return await ofBaby
            .Where(vaccination => vaccination.UpdatedAt >= from)
            .OrderBy(vaccination => vaccination.UpdatedAt)
            .ThenBy(vaccination => vaccination.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Vaccination>> ListActiveAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        await context.Vaccinations
            .AsNoTracking()
            .Where(vaccination => vaccination.BabyId == babyId && vaccination.DeletedAt == null)
            .OrderBy(vaccination => vaccination.GivenOn)
            .ThenBy(vaccination => vaccination.Id)
            .ToListAsync(cancellationToken);

    public async Task<bool> TryAddAsync(Vaccination vaccination, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(vaccination);
        try
        {
            context.Vaccinations.Add(vaccination);
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.Entry(vaccination).State = EntityState.Detached;
            return false;
        }
        catch (DbUpdateException exception)
        {
            context.Entry(vaccination).State = EntityState.Detached;
            logger.LogError(exception, "Saving new vaccination {VaccinationId} failed with a database error that is not a unique violation", vaccination.Id);
            throw;
        }
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
