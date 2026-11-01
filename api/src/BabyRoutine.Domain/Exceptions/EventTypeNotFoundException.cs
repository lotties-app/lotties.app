namespace BabyRoutine.Domain.Exceptions;

/// <summary>No event type with the id is available to the baby.</summary>
public sealed class EventTypeNotFoundException : DomainException
{
    public EventTypeNotFoundException(Guid babyId, Guid eventTypeId)
        : base("event_type_not_found", $"Event type {eventTypeId} was not found for baby {babyId}.")
    {
        BabyId = babyId;
        EventTypeId = eventTypeId;
    }

    public Guid BabyId { get; }

    public Guid EventTypeId { get; }
}
