using BabyRoutine.Domain.Medications;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety of <see cref="TryAddAsync"/> relies on the primary key: a concurrent insert of the same id fails, the
/// rejected entity is detached and <c>false</c> is returned.
/// </remarks>
internal sealed class EfMedicationRepository(BabyRoutineDbContext context) : IMedicationRepository
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
        catch (DbUpdateException exception)
        {
            return await WasInsertedConcurrentlyAsync(medication, cancellationToken)
                ? false
                : throw new InvalidOperationException($"Saving medication {medication.Id} failed and no medication with that id exists.", exception);
        }
    }

    public async Task RemoveAsync(Medication medication, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(medication);
        context.Medications.Remove(medication);
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);

    private async Task<bool> WasInsertedConcurrentlyAsync(Medication rejected, CancellationToken cancellationToken)
    {
        context.Entry(rejected).State = EntityState.Detached;
        return await context.Medications.AsNoTracking().AnyAsync(stored => stored.Id == rejected.Id, cancellationToken);
    }
}
