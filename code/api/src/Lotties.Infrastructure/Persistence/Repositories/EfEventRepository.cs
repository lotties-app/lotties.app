using Lotties.Domain.Events;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Reads go through <see cref="LottiesDataDbContext.EventsIncludingDeleted"/> so soft-deleted events are visible to
/// upserts (a deleted event stays deleted) and to delta sync (clients learn about deletions). Race safety of
/// <see cref="TryAddAsync"/> relies on the primary key: a concurrent insert of the same id fails with a unique
/// violation, the rejected entity is detached and <c>false</c> is returned. Any other database error is logged and rethrown.
/// </remarks>
internal sealed class EfEventRepository(LottiesDataDbContext context, UniqueViolations uniqueViolations, ILogger<EfEventRepository> logger) : IEventRepository
{
    public Task<Event?> FindAsync(Guid eventId, CancellationToken cancellationToken = default) =>
        context.EventsIncludingDeleted.SingleOrDefaultAsync(stored => stored.Id == eventId, cancellationToken);

    public Task<Event?> FindForBabyAsync(Guid babyId, Guid eventId, CancellationToken cancellationToken = default) =>
        context.EventsIncludingDeleted.SingleOrDefaultAsync(stored => stored.Id == eventId && stored.BabyId == babyId, cancellationToken);

    public async Task<bool> TryAddAsync(Event created, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(created);
        try
        {
            context.Events.Add(created);
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.Entry(created).State = EntityState.Detached;
            return false;
        }
        catch (DbUpdateException exception)
        {
            context.Entry(created).State = EntityState.Detached;
            logger.LogError(exception, "Saving new event {EventId} failed with a database error that is not a unique violation", created.Id);
            throw;
        }
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);

    public async Task<IReadOnlyList<Event>> ListChangesAsync(Guid babyId, EventSyncCursor? after, int take, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(take);
        return await ChangesQuery(context, babyId, after, take).ToListAsync(cancellationToken);
    }

    /// <summary>The delta query of <see cref="ListChangesAsync"/>; exposed to tests to check its SQL translation.</summary>
    internal static IQueryable<Event> ChangesQuery(LottiesDataDbContext context, Guid babyId, EventSyncCursor? after, int take) =>
        StrictlyAfter(context.EventsIncludingDeleted.AsNoTracking().Where(stored => stored.BabyId == babyId), after)
            .OrderBy(stored => stored.UpdatedAt)
            .ThenBy(stored => stored.Id)
            .Take(take);

    private static IQueryable<Event> StrictlyAfter(IQueryable<Event> events, EventSyncCursor? after)
    {
        if (after is not { } cursor)
        {
            return events;
        }

        var updatedAt = cursor.UpdatedAt;
        var eventId = cursor.EventId;
        return events.Where(stored => stored.UpdatedAt > updatedAt || (stored.UpdatedAt == updatedAt && stored.Id.CompareTo(eventId) > 0));
    }
}
