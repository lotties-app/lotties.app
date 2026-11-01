namespace Lotties.Application.Measurements;

/// <summary>Growth measurement use cases of one baby. Callers have already authorized the current user for the baby.</summary>
public interface IMeasurementService
{
    /// <summary>The baby's measurements, newest date first.</summary>
    Task<IReadOnlyList<MeasurementResponse>> ListAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Idempotent upsert by client id: creates the measurement or applies the full state to the existing one. Throws
    /// <see cref="Domain.Exceptions.MeasurementBabyMismatchException"/> when the id belongs to another baby.
    /// </summary>
    Task<UpsertMeasurementResult> UpsertAsync(Guid babyId, Guid measurementId, UpsertMeasurementRequest request, CancellationToken cancellationToken = default);

    /// <summary>Hard deletes the measurement. Unknown ids and ids of another baby are a no-op.</summary>
    Task DeleteAsync(Guid babyId, Guid measurementId, CancellationToken cancellationToken = default);
}
