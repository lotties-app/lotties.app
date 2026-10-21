namespace BabyRoutine.Application.Events;

/// <summary>Event use cases for offline sync. Callers have already authorized the current user for the baby.</summary>
public interface IEventService
{
    /// <summary>
    /// Idempotent upsert by client id: creates the event when it does not exist, otherwise applies the details
    /// (see <see cref="Domain.Events.Event.DecideUpsert"/> for the deleted, stale and other-baby rules).
    /// </summary>
    Task<UpsertEventResult> UpsertAsync(Guid babyId, Guid eventId, UpsertEventRequest request, CancellationToken cancellationToken = default);

    /// <summary>Soft deletes the event. Unknown ids and already deleted events are a no-op.</summary>
    Task DeleteAsync(Guid babyId, Guid eventId, CancellationToken cancellationToken = default);

    /// <summary>The event of the baby, deleted or not; throws <see cref="Domain.Exceptions.EventNotFoundException"/> when there is none.</summary>
    Task<EventResponse> GetAsync(Guid babyId, Guid eventId, CancellationToken cancellationToken = default);

    /// <summary>One page of the baby's events changed since a point, soft-deleted included.</summary>
    Task<EventChangesPage> ListChangesAsync(Guid babyId, ListEventChangesRequest request, CancellationToken cancellationToken = default);
}
