namespace Lotties.Application.Events;

/// <summary>Event use cases for offline sync. Callers have already authorized the current user for the baby.</summary>
public interface IEventService
{
    /// <summary>
    /// Idempotent upsert by client id: creates the event when it does not exist, otherwise applies the details
    /// (see <see cref="Domain.Events.Event.DecideUpsert"/> for the deleted, stale and other-baby rules). Changing a stored
    /// event the caller may not change (a Caregiver and an event another member logged, beyond stopping, pausing or resuming
    /// it while it runs) throws <see cref="Domain.Exceptions.EventNotOwnedException"/>.
    /// </summary>
    Task<UpsertEventResult> UpsertAsync(Guid babyId, Guid eventId, UpsertEventRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Soft deletes the event. Unknown ids are a no-op, and so are already deleted events the caller may change; an event
    /// the caller may not change throws <see cref="Domain.Exceptions.EventNotOwnedException"/>.
    /// </summary>
    Task DeleteAsync(Guid babyId, Guid eventId, CancellationToken cancellationToken = default);

    /// <summary>The event of the baby, deleted or not; throws <see cref="Domain.Exceptions.EventNotFoundException"/> when there is none.</summary>
    Task<EventResponse> GetAsync(Guid babyId, Guid eventId, CancellationToken cancellationToken = default);

    /// <summary>One page of the baby's events changed since a point, soft-deleted included.</summary>
    Task<EventChangesPage> ListChangesAsync(Guid babyId, ListEventChangesRequest request, CancellationToken cancellationToken = default);
}
