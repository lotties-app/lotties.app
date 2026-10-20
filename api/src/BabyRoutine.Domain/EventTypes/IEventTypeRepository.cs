namespace BabyRoutine.Domain.EventTypes;

/// <summary>Read access to event types (built-in templates and babies' custom types).</summary>
public interface IEventTypeRepository
{
    /// <summary>The event type with <paramref name="eventTypeId"/>, or null when there is none.</summary>
    Task<EventType?> FindAsync(Guid eventTypeId, CancellationToken cancellationToken = default);
}
