using Lotties.Domain.EventTypes;
using Lotties.Domain.Prescriptions;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety of <see cref="TryAddAsync"/> relies on the primary key: a concurrent insert of the same id fails with a
/// unique violation, the rejected entity is detached and <c>false</c> is returned. Any other database error is logged and rethrown.
/// </remarks>
internal sealed class EfPrescriptionRepository(LottiesDbContext context, UniqueViolations uniqueViolations, ILogger<EfPrescriptionRepository> logger) : IPrescriptionRepository
{
    public Task<Prescription?> FindAsync(Guid prescriptionId, CancellationToken cancellationToken = default) =>
        context.Prescriptions.SingleOrDefaultAsync(prescription => prescription.Id == prescriptionId, cancellationToken);

    public async Task<IReadOnlyList<Prescription>> FindManyAsync(IReadOnlyCollection<Guid> prescriptionIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(prescriptionIds);
        var ids = prescriptionIds.Distinct().ToList();
        return ids.Count == 0 ? [] : await context.Prescriptions.AsNoTracking().Where(prescription => ids.Contains(prescription.Id)).ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Prescription>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var query = context.Prescriptions.AsNoTracking().Where(prescription => prescription.BabyId == babyId);
        var changed = since is { } from ? query.Where(prescription => prescription.UpdatedAt >= from.ToUniversalTime()) : query;
        return await changed.OrderBy(prescription => prescription.UpdatedAt).ThenBy(prescription => prescription.Id).ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Prescription>> ListActiveAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        await context.Prescriptions
            .AsNoTracking()
            .Where(prescription => prescription.BabyId == babyId && prescription.DeletedAt == null && prescription.Status == PrescriptionStatus.Active)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<Prescription>> ListForMedicationAsync(Guid babyId, Guid medicationId, CancellationToken cancellationToken = default) =>
        await context.Prescriptions
            .Where(prescription => prescription.BabyId == babyId && prescription.MedicationId == medicationId && prescription.DeletedAt == null)
            .ToListAsync(cancellationToken);

    public async Task<bool> TryAddAsync(Prescription prescription, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(prescription);
        try
        {
            context.Prescriptions.Add(prescription);
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.Entry(prescription).State = EntityState.Detached;
            return false;
        }
        catch (DbUpdateException exception)
        {
            context.Entry(prescription).State = EntityState.Detached;
            logger.LogError(exception, "Saving new prescription {PrescriptionId} failed with a database error that is not a unique violation", prescription.Id);
            throw;
        }
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}

/// <remarks>
/// Reads the start time and payload of the baby's non-deleted built-in medication events (served by the
/// <c>(baby_id, started_at)</c> index) and extracts the doses in memory, so the query stays provider-neutral.
/// </remarks>
internal sealed class EfMedicationDoseHistoryRepository(LottiesDbContext context) : IMedicationDoseHistoryRepository
{
    public async Task<IReadOnlyList<MedicationDose>> ListDosesAsync(Guid babyId, DateTimeOffset since, CancellationToken cancellationToken = default)
    {
        var from = since.ToUniversalTime();
        var rows = await context.Events
            .AsNoTracking()
            .Where(item => item.BabyId == babyId && item.TypeId == BuiltInEventTypes.MedicationId && item.StartedAt >= from)
            .Select(item => new { item.StartedAt, item.Payload })
            .ToListAsync(cancellationToken);
        return rows
            .SelectMany(row => MedicationDosePayload.ReadDoses(row.Payload, row.StartedAt))
            .OrderBy(dose => dose.GivenAt)
            .ToArray();
    }
}
