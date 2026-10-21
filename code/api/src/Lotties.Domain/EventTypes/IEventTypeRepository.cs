namespace Lotties.Domain.EventTypes;

/// <summary>Persistence for event types (built-in templates and custom types of babies).</summary>
public interface IEventTypeRepository
{
    /// <summary>The event type with <paramref name="eventTypeId"/>, or null when there is none; not tracked.</summary>
    Task<EventType?> FindAsync(Guid eventTypeId, CancellationToken cancellationToken = default);

    /// <summary>The event type with <paramref name="eventTypeId"/>, or null when there is none; tracked for changes.</summary>
    Task<EventType?> FindForUpdateAsync(Guid eventTypeId, CancellationToken cancellationToken = default);

    /// <summary>Built-in templates first, then the baby's custom types, each group ordered by name; not tracked.</summary>
    Task<IReadOnlyList<EventType>> ListAvailableAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Whether <paramref name="key"/> is used by a built-in type or a custom type of the baby.</summary>
    Task<bool> KeyExistsAsync(Guid babyId, EventTypeKey key, CancellationToken cancellationToken = default);

    /// <summary>Whether any event, soft-deleted included, references the type.</summary>
    Task<bool> HasEventsAsync(Guid eventTypeId, CancellationToken cancellationToken = default);

    /// <summary>Saves a new type. Returns <c>false</c>, leaving nothing tracked, when its key was saved first (concurrent create).</summary>
    Task<bool> TryAddAsync(EventType eventType, CancellationToken cancellationToken = default);

    Task RemoveAsync(EventType eventType, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
