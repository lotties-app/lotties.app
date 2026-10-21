namespace Lotties.Domain.Exceptions;

/// <summary>A custom event type that events still reference cannot be deleted.</summary>
public sealed class EventTypeInUseException : DomainException
{
    public EventTypeInUseException(Guid eventTypeId)
        : base("event_type_in_use", $"Event type {eventTypeId} is used by events and cannot be deleted.")
    {
        EventTypeId = eventTypeId;
    }

    public Guid EventTypeId { get; }
}
