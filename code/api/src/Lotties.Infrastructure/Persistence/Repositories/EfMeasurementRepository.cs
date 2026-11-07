using Lotties.Domain.Measurements;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety of <see cref="TryAddAsync"/> relies on the primary key: a concurrent insert of the same id fails with a
/// unique violation, the rejected entity is detached and <c>false</c> is returned. Any other database error is logged and rethrown.
/// </remarks>
internal sealed class EfMeasurementRepository(LottiesDataDbContext context, UniqueViolations uniqueViolations, ILogger<EfMeasurementRepository> logger) : IMeasurementRepository
{
    public async Task<IReadOnlyList<Measurement>> ListForBabyAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        await context.Measurements
            .AsNoTracking()
            .Where(measurement => measurement.BabyId == babyId)
            .OrderByDescending(measurement => measurement.Date)
            .ThenByDescending(measurement => measurement.CreatedAt)
            .ThenBy(measurement => measurement.Id)
            .ToListAsync(cancellationToken);

    public Task<Measurement?> FindLatestWithWeightAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        context.Measurements
            .AsNoTracking()
            .Where(measurement => measurement.BabyId == babyId && measurement.WeightKg != null)
            .OrderByDescending(measurement => measurement.Date)
            .ThenByDescending(measurement => measurement.CreatedAt)
            .ThenBy(measurement => measurement.Id)
            .FirstOrDefaultAsync(cancellationToken);

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
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.Entry(measurement).State = EntityState.Detached;
            return false;
        }
        catch (DbUpdateException exception)
        {
            context.Entry(measurement).State = EntityState.Detached;
            logger.LogError(exception, "Saving new measurement {MeasurementId} failed with a database error that is not a unique violation", measurement.Id);
            throw;
        }
    }

    public async Task RemoveAsync(Measurement measurement, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(measurement);
        context.Measurements.Remove(measurement);
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
