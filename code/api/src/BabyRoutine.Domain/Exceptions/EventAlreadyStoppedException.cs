namespace BabyRoutine.Domain.Exceptions;

/// <summary>Stop was requested for an event that is not running.</summary>
public sealed class EventAlreadyStoppedException : DomainException
{
    public EventAlreadyStoppedException(Guid eventId)
        : base("event_already_stopped", $"Event {eventId} is not running.")
    {
        EventId = eventId;
    }

    public Guid EventId { get; }
}
