using BabyRoutine.Domain.EventTypes;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety of <see cref="TryAddAsync"/> relies on the unique index on <c>(baby_id, key)</c>: a concurrent insert
/// of the same key fails, the rejected entity is detached and <c>false</c> is returned.
/// </remarks>
internal sealed class EfEventTypeRepository(BabyRoutineDbContext context) : IEventTypeRepository
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
        catch (DbUpdateException exception)
        {
            return await WasKeyTakenConcurrentlyAsync(eventType, cancellationToken)
                ? false
                : throw new InvalidOperationException($"Saving event type {eventType.Id} failed and its key is not taken.", exception);
        }
    }

    public async Task RemoveAsync(EventType eventType, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(eventType);
        context.EventTypes.Remove(eventType);
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);

    private async Task<bool> WasKeyTakenConcurrentlyAsync(EventType rejected, CancellationToken cancellationToken)
    {
        context.Entry(rejected).State = EntityState.Detached;
        return rejected.BabyId is { } babyId && await KeyExistsAsync(babyId, rejected.Key, cancellationToken);
    }
}
