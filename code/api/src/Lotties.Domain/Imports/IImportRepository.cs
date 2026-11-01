namespace Lotties.Domain.Imports;

/// <summary>Persistence for bulk imports.</summary>
public interface IImportRepository
{
    /// <summary>The ids among <paramref name="eventIds"/> that already exist (any baby, soft-deleted included).</summary>
    Task<IReadOnlySet<Guid>> FindExistingEventIdsAsync(IReadOnlyCollection<Guid> eventIds, CancellationToken cancellationToken = default);

    /// <summary>The ids among <paramref name="measurementIds"/> that already exist (any baby).</summary>
    Task<IReadOnlySet<Guid>> FindExistingMeasurementIdsAsync(IReadOnlyCollection<Guid> measurementIds, CancellationToken cancellationToken = default);

    /// <summary>The events of <paramref name="babyId"/> among <paramref name="eventIds"/> that are not soft deleted, read-only.</summary>
    Task<IReadOnlyList<Events.Event>> FindEventsAsync(Guid babyId, IReadOnlyCollection<Guid> eventIds, CancellationToken cancellationToken = default);

    /// <summary>
    /// Inserts the whole batch and applies its enrichments in one transaction, in chunks: either everything is saved or
    /// nothing is. Throws <see cref="Exceptions.ImportConflictException"/> when a record was saved concurrently, or an
    /// event to enrich was deleted or changed since the plan (<see cref="Events.Event.TryEnrichPayload"/>).
    /// </summary>
    Task SaveAsync(ImportBatch batch, CancellationToken cancellationToken = default);
}
