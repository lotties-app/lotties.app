namespace BabyRoutine.Application.EventTypes;

/// <summary>
/// Event type use cases of one baby. Callers have already authorized the current user for the baby. Built-in templates
/// are read-only; custom types are archived by deletion only when no event references them.
/// </summary>
public interface IEventTypeService
{
    /// <summary>Built-in templates followed by the baby's custom types.</summary>
    Task<IReadOnlyList<EventTypeResponse>> ListAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Creates a custom type; throws <see cref="Domain.Exceptions.EventTypeKeyTakenException"/> when the key is in use.</summary>
    Task<EventTypeResponse> CreateAsync(Guid babyId, CreateEventTypeRequest request, CancellationToken cancellationToken = default);

    /// <summary>Edits a custom type; throws <see cref="Domain.Exceptions.BuiltInEventTypeReadOnlyException"/> for built-ins.</summary>
    Task<EventTypeResponse> UpdateAsync(Guid babyId, Guid eventTypeId, UpdateEventTypeRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes a custom type. Throws <see cref="Domain.Exceptions.EventTypeInUseException"/> when any event (soft-deleted
    /// included) references it and <see cref="Domain.Exceptions.BuiltInEventTypeReadOnlyException"/> for built-ins.
    /// </summary>
    Task DeleteAsync(Guid babyId, Guid eventTypeId, CancellationToken cancellationToken = default);
}
