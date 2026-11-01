namespace Lotties.Domain.Exceptions;

/// <summary>
/// A member whose role only logs events (Caregiver) tried to edit or delete an event another member logged beyond
/// stopping, pausing or resuming it while it runs (<see cref="Events.RunningEventControl"/>); only Owners and Parents
/// change events of others.
/// </summary>
public sealed class EventNotOwnedException : DomainException
{
    public EventNotOwnedException(Guid eventId, Guid userId)
        : base("event_not_owned", $"Event {eventId} was logged by another member; this role can only edit or delete its own events, and stop, pause or resume a running one.")
    {
        EventId = eventId;
        UserId = userId;
    }

    public Guid EventId { get; }

    public Guid UserId { get; }
}
