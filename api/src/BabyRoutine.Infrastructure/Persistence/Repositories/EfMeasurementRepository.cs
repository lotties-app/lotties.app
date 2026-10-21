using BabyRoutine.Domain.Measurements;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety of <see cref="TryAddAsync"/> relies on the primary key: a concurrent insert of the same id fails, the
/// rejected entity is detached and <c>false</c> is returned.
/// </remarks>
internal sealed class EfMeasurementRepository(BabyRoutineDbContext context) : IMeasurementRepository
{
    public async Task<IReadOnlyList<Measurement>> ListForBabyAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        await context.Measurements
            .AsNoTracking()
            .Where(measurement => measurement.BabyId == babyId)
            .OrderByDescending(measurement => measurement.Date)
            .ThenByDescending(measurement => measurement.CreatedAt)
            .ThenBy(measurement => measurement.Id)
            .ToListAsync(cancellationToken);

    public Task<Measurement?> FindAsync(Guid measurementId, CancellationToken cancellationToken = default) =>
        context.Measurements.SingleOrDefaultAsync(measurement => measurement.Id == measurementId, cancellationToken);

    public async Task<bool> TryAddAsync(Measurement measurement, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(measurement);
        try
        {
            context.Measurements.Add(measurement);
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception)
        {
            return await WasInsertedConcurrentlyAsync(measurement, cancellationToken)
                ? false
                : throw new InvalidOperationException($"Saving measurement {measurement.Id} failed and no measurement with that id exists.", exception);
        }
    }

    public async Task RemoveAsync(Measurement measurement, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(measurement);
        context.Measurements.Remove(measurement);
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);

    private async Task<bool> WasInsertedConcurrentlyAsync(Measurement rejected, CancellationToken cancellationToken)
    {
        context.Entry(rejected).State = EntityState.Detached;
        return await context.Measurements.AsNoTracking().AnyAsync(stored => stored.Id == rejected.Id, cancellationToken);
    }
}
