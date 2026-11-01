namespace Lotties.Domain.Measurements;

/// <summary>Persistence for <see cref="Measurement"/>. Measurements are hard deleted.</summary>
public interface IMeasurementRepository
{
    /// <summary>The baby's measurements, newest date first; not tracked.</summary>
    Task<IReadOnlyList<Measurement>> ListForBabyAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>The baby's measurement with a weight on the latest date (newest created first on ties), or <c>null</c>; not tracked.</summary>
    Task<Measurement?> FindLatestWithWeightAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>The measurement with <paramref name="measurementId"/> whatever baby it belongs to; tracked for changes.</summary>
    Task<Measurement?> FindAsync(Guid measurementId, CancellationToken cancellationToken = default);

    /// <summary>Saves a new measurement. Returns <c>false</c>, leaving nothing tracked, when the id was saved first (concurrent upsert).</summary>
    Task<bool> TryAddAsync(Measurement measurement, CancellationToken cancellationToken = default);

    Task RemoveAsync(Measurement measurement, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
