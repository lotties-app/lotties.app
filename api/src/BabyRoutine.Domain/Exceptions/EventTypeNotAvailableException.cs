namespace BabyRoutine.Domain.Exceptions;

/// <summary>An event referenced an event type that does not exist or belongs to another baby.</summary>
public sealed class EventTypeNotAvailableException : DomainException
{
    public EventTypeNotAvailableException(Guid eventTypeId, Guid babyId)
        : base("event_type_not_available", $"Event type {eventTypeId} is not a built-in type nor a custom type of baby {babyId}.")
    {
        EventTypeId = eventTypeId;
        BabyId = babyId;
    }

    public Guid EventTypeId { get; }

    public Guid BabyId { get; }
}
