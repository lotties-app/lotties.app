namespace Lotties.Domain.Exceptions;

/// <summary>An upsert addressed an existing event through a baby it does not belong to; events never move between babies.</summary>
public sealed class EventBabyMismatchException : DomainException
{
    public EventBabyMismatchException(Guid eventId, Guid requestedBabyId)
        : base("event_baby_mismatch", $"Event {eventId} does not belong to baby {requestedBabyId}; an event cannot change baby.")
    {
        EventId = eventId;
        RequestedBabyId = requestedBabyId;
    }

    public Guid EventId { get; }

    public Guid RequestedBabyId { get; }
}
