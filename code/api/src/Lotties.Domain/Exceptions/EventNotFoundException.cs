namespace Lotties.Domain.Exceptions;

/// <summary>No event with the id exists for the baby.</summary>
public sealed class EventNotFoundException : DomainException
{
    public EventNotFoundException(Guid babyId, Guid eventId)
        : base("event_not_found", $"Event {eventId} was not found for baby {babyId}.")
    {
        BabyId = babyId;
        EventId = eventId;
    }

    public Guid BabyId { get; }

    public Guid EventId { get; }
}
