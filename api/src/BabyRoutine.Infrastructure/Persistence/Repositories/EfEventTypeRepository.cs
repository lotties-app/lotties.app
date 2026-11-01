using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety of <see cref="TryAddAsync"/> relies on the unique index on <c>(baby_id, key)</c>: a concurrent insert
/// of the same key fails with a unique violation, the rejected entity is detached and <c>false</c> is returned. Any
/// other database error is logged and rethrown.
/// </remarks>
internal sealed class EfEventTypeRepository(BabyRoutineDbContext context, UniqueViolations uniqueViolations, ILogger<EfEventTypeRepository> logger) : IEventTypeRepository
{
    public Task<EventType?> FindAsync(Guid eventTypeId, CancellationToken cancellationToken = default) =>
        context.EventTypes.AsNoTracking().SingleOrDefaultAsync(eventType => eventType.Id == eventTypeId, cancellationToken);

    public Task<EventType?> FindForUpdateAsync(Guid eventTypeId, CancellationToken cancellationToken = default) =>
        context.EventTypes.SingleOrDefaultAsync(eventType => eventType.Id == eventTypeId, cancellationToken);

    public async Task<IReadOnlyList<EventType>> ListAvailableAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        await context.EventTypes
            .AsNoTracking()
            .Where(eventType => eventType.BabyId == null || eventType.BabyId == babyId)
            .OrderBy(eventType => eventType.BabyId != null)
            .ThenBy(eventType => eventType.Name)
            .ThenBy(eventType => eventType.Id)
            .ToListAsync(cancellationToken);

    public Task<bool> KeyExistsAsync(Guid babyId, EventTypeKey key, CancellationToken cancellationToken = default) =>
        context.EventTypes.AnyAsync(eventType => (eventType.BabyId == null || eventType.BabyId == babyId) && eventType.Key == key, cancellationToken);

    public Task<bool> HasEventsAsync(Guid eventTypeId, CancellationToken cancellationToken = default) =>
        context.EventsIncludingDeleted.AnyAsync(stored => stored.TypeId == eventTypeId, cancellationToken);

    public async Task<bool> TryAddAsync(EventType eventType, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(eventType);
        try
        {
            context.EventTypes.Add(eventType);
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.Entry(eventType).State = EntityState.Detached;
            return false;
        }
        catch (DbUpdateException exception)
        {
            context.Entry(eventType).State = EntityState.Detached;
            logger.LogError(exception, "Saving new event type {EventTypeId} failed with a database error that is not a unique violation", eventType.Id);
            throw;
        }
    }

    public async Task RemoveAsync(EventType eventType, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(eventType);
        context.EventTypes.Remove(eventType);
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
