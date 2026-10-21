namespace BabyRoutine.Domain.Imports;

/// <summary>Persistence for bulk imports.</summary>
public interface IImportRepository
{
    /// <summary>The ids among <paramref name="eventIds"/> that already exist (any baby, soft-deleted included).</summary>
    Task<IReadOnlySet<Guid>> FindExistingEventIdsAsync(IReadOnlyCollection<Guid> eventIds, CancellationToken cancellationToken = default);

    /// <summary>The ids among <paramref name="measurementIds"/> that already exist (any baby).</summary>
    Task<IReadOnlySet<Guid>> FindExistingMeasurementIdsAsync(IReadOnlyCollection<Guid> measurementIds, CancellationToken cancellationToken = default);

    /// <summary>
    /// Inserts the whole batch in one transaction, in chunks: either everything is saved or nothing is. Throws
    /// <see cref="Exceptions.ImportConflictException"/> when a record was saved concurrently.
    /// </summary>
    Task SaveAsync(ImportBatch batch, CancellationToken cancellationToken = default);
}
