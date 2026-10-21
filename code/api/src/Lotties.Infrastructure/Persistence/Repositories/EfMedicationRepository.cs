using Lotties.Domain.Medications;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety of <see cref="TryAddAsync"/> relies on the primary key: a concurrent insert of the same id fails with a
/// unique violation, the rejected entity is detached and <c>false</c> is returned. Any other database error is logged and rethrown.
/// </remarks>
internal sealed class EfMedicationRepository(LottiesDbContext context, UniqueViolations uniqueViolations, ILogger<EfMedicationRepository> logger) : IMedicationRepository
{
    public async Task<IReadOnlyList<Medication>> ListForBabyAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        await context.Medications
            .AsNoTracking()
            .Where(medication => medication.BabyId == babyId)
            .OrderByDescending(medication => medication.IsUsual)
            .ThenBy(medication => medication.Name)
            .ThenBy(medication => medication.Id)
            .ToListAsync(cancellationToken);

    public Task<Medication?> FindAsync(Guid medicationId, CancellationToken cancellationToken = default) =>
        context.Medications.SingleOrDefaultAsync(medication => medication.Id == medicationId, cancellationToken);

    public async Task<bool> TryAddAsync(Medication medication, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(medication);
        try
        {
            context.Medications.Add(medication);
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.Entry(medication).State = EntityState.Detached;
            return false;
        }
        catch (DbUpdateException exception)
        {
            context.Entry(medication).State = EntityState.Detached;
            logger.LogError(exception, "Saving new medication {MedicationId} failed with a database error that is not a unique violation", medication.Id);
            throw;
        }
    }

    public async Task RemoveAsync(Medication medication, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(medication);
        context.Medications.Remove(medication);
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
