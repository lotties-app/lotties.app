using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Imports;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// <see cref="SaveAsync"/> runs one explicit transaction and saves in chunks of <see cref="ChunkSize"/> rows, clearing
/// the change tracker between chunks so large imports stay cheap. Any failure rolls the whole batch back; a unique
/// key violation (a concurrent import of the same records) becomes <see cref="ImportConflictException"/>, any other
/// database error is logged and rethrown. Enrichments are applied in the same transaction after the inserts: each chunk
/// of events is loaded tracked (soft-deleted ones are hidden by the query filter) and changed through
/// <see cref="Event.TryEnrichPayload"/>; an event that is gone or whose payload changed since the plan aborts the whole
/// import with <see cref="ImportConflictException"/>. Id lookups are chunked to keep the parameter lists bounded.
/// </remarks>
internal sealed class EfImportRepository(LottiesDbContext context, UniqueViolations uniqueViolations, ILogger<EfImportRepository> logger) : IImportRepository
{
    public const int ChunkSize = 500;

    public async Task<IReadOnlySet<Guid>> FindExistingEventIdsAsync(IReadOnlyCollection<Guid> eventIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(eventIds);
        var found = new HashSet<Guid>();
        foreach (var chunk in Chunks(eventIds))
        {
            found.UnionWith(await context.EventsIncludingDeleted.AsNoTracking().Where(stored => chunk.Contains(stored.Id)).Select(stored => stored.Id).ToListAsync(cancellationToken));
        }

        return found;
    }

    public async Task<IReadOnlySet<Guid>> FindExistingMeasurementIdsAsync(IReadOnlyCollection<Guid> measurementIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(measurementIds);
        var found = new HashSet<Guid>();
        foreach (var chunk in Chunks(measurementIds))
        {
            found.UnionWith(await context.Measurements.AsNoTracking().Where(stored => chunk.Contains(stored.Id)).Select(stored => stored.Id).ToListAsync(cancellationToken));
        }

        return found;
    }

    public async Task<IReadOnlyList<Event>> FindEventsAsync(Guid babyId, IReadOnlyCollection<Guid> eventIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(eventIds);
        var found = new List<Event>();
        foreach (var chunk in Chunks(eventIds))
        {
            found.AddRange(await context.Events.AsNoTracking().Where(stored => stored.BabyId == babyId && chunk.Contains(stored.Id)).ToListAsync(cancellationToken));
        }

        return found;
    }

    public async Task SaveAsync(ImportBatch batch, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(batch);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await AddInChunksAsync(batch.Medications, cancellationToken);
            await AddInChunksAsync(batch.Events, cancellationToken);
            await AddInChunksAsync(batch.Measurements, cancellationToken);
            await EnrichInChunksAsync(batch.Enrichments, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (ImportConflictException)
        {
            context.ChangeTracker.Clear();
            throw;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.ChangeTracker.Clear();
            throw new ImportConflictException(exception);
        }
        catch (DbUpdateException exception)
        {
            context.ChangeTracker.Clear();
            logger.LogError(exception, "Saving an import batch of {EventCount} events failed with a database error that is not a unique violation", batch.Events.Count);
            throw;
        }
    }

    /// <remarks>Lists, not arrays: <c>array.Contains</c> may bind to the span overload, which EF Core cannot translate.</remarks>
    private static IEnumerable<List<Guid>> Chunks(IReadOnlyCollection<Guid> ids) => ids.Chunk(ChunkSize).Select(chunk => chunk.ToList());

    private async Task EnrichInChunksAsync(IReadOnlyList<EventEnrichment> enrichments, CancellationToken cancellationToken)
    {
        foreach (var chunk in enrichments.Chunk(ChunkSize))
        {
            var ids = chunk.Select(enrichment => enrichment.EventId).ToList();
            var stored = await context.Events.Where(item => ids.Contains(item.Id)).ToDictionaryAsync(item => item.Id, cancellationToken);
            Array.ForEach(chunk, enrichment => Apply(stored.GetValueOrDefault(enrichment.EventId), enrichment));
            await context.SaveChangesAsync(cancellationToken);
            context.ChangeTracker.Clear();
        }
    }

    private static void Apply(Event? stored, EventEnrichment enrichment)
    {
        if (stored is null || !stored.TryEnrichPayload(enrichment.ExpectedPayload, enrichment.Enriched.Payload, enrichment.EnrichedAt))
        {
            throw new ImportConflictException();
        }
    }

    private async Task AddInChunksAsync<TEntity>(IReadOnlyList<TEntity> entities, CancellationToken cancellationToken)
        where TEntity : class
    {
        foreach (var chunk in entities.Chunk(ChunkSize))
        {
            context.AddRange(chunk);
            await context.SaveChangesAsync(cancellationToken);
            context.ChangeTracker.Clear();
        }
    }
}
