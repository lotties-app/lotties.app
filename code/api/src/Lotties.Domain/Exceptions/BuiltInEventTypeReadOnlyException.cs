namespace Lotties.Domain.Exceptions;

/// <summary>A built-in event type template cannot be modified.</summary>
public sealed class BuiltInEventTypeReadOnlyException : DomainException
{
    public BuiltInEventTypeReadOnlyException(Guid eventTypeId)
        : base("event_type_built_in_read_only", $"Event type {eventTypeId} is a built-in template and cannot be modified.")
    {
        EventTypeId = eventTypeId;
    }

    public Guid EventTypeId { get; }
}
