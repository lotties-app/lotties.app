namespace BabyRoutine.Domain.Exceptions;

/// <summary>A change was requested for an event that has been soft deleted.</summary>
public sealed class EventDeletedException : DomainException
{
    public EventDeletedException(Guid eventId)
        : base("event_deleted", $"Event {eventId} has been deleted.")
    {
        EventId = eventId;
    }

    public Guid EventId { get; }
}
