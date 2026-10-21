using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Imports;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// <see cref="SaveAsync"/> runs one explicit transaction and saves in chunks of <see cref="ChunkSize"/> rows, clearing
/// the change tracker between chunks so large imports stay cheap. Any failure rolls the whole batch back; a unique
/// key violation (a concurrent import of the same records) becomes <see cref="ImportConflictException"/>. Id lookups
/// are chunked to keep the parameter lists bounded.
/// </remarks>
internal sealed class EfImportRepository(BabyRoutineDbContext context) : IImportRepository
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

    public async Task SaveAsync(ImportBatch batch, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(batch);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await AddInChunksAsync(batch.Medications, cancellationToken);
            await AddInChunksAsync(batch.Events, cancellationToken);
            await AddInChunksAsync(batch.Measurements, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception)
        {
            context.ChangeTracker.Clear();
            throw new ImportConflictException(exception);
        }
    }

    /// <remarks>Lists, not arrays: <c>array.Contains</c> may bind to the span overload, which EF Core cannot translate.</remarks>
    private static IEnumerable<List<Guid>> Chunks(IReadOnlyCollection<Guid> ids) => ids.Chunk(ChunkSize).Select(chunk => chunk.ToList());

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
