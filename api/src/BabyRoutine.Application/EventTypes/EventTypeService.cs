using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Exceptions;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Application.EventTypes;

internal sealed class EventTypeService : IEventTypeService
{
    private readonly IEventTypeRepository _eventTypes;
    private readonly ILogger<EventTypeService> _logger;

    public EventTypeService(IEventTypeRepository eventTypes, ILogger<EventTypeService> logger)
    {
        _eventTypes = eventTypes ?? throw new ArgumentNullException(nameof(eventTypes));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<EventTypeResponse>> ListAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var available = await _eventTypes.ListAvailableAsync(babyId, cancellationToken);
        return available.Select(eventType => (EventTypeResponse)eventType).ToArray();
    }

    public async Task<EventTypeResponse> CreateAsync(Guid babyId, CreateEventTypeRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var key = EventTypeKey.From(request.Key);
        await EnsureKeyFreeAsync(babyId, key, cancellationToken);
        var created = EventType.CreateCustom(babyId, key, request.Name, request.Icon, HexColor.From(request.Color), request.HasDuration, ToDefinitions(request.Fields));
        await AddOrThrowAsync(created, cancellationToken);
        _logger.LogInformation("Created event type {EventTypeId} ({Key}) for baby {BabyId}", created.Id, key, babyId);
        return created;
    }

    public async Task<EventTypeResponse> UpdateAsync(Guid babyId, Guid eventTypeId, UpdateEventTypeRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var eventType = await LoadAsync(babyId, eventTypeId, cancellationToken);
        eventType.Update(request.Name, request.Icon, HexColor.From(request.Color), request.HasDuration, ToDefinitions(request.Fields));
        await _eventTypes.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Updated event type {EventTypeId} of baby {BabyId}", eventTypeId, babyId);
        return eventType;
    }

    public async Task DeleteAsync(Guid babyId, Guid eventTypeId, CancellationToken cancellationToken = default)
    {
        var eventType = await LoadAsync(babyId, eventTypeId, cancellationToken);
        eventType.EnsureDeletable();
        await EnsureUnusedAsync(eventTypeId, cancellationToken);
        await _eventTypes.RemoveAsync(eventType, cancellationToken);
        _logger.LogInformation("Deleted event type {EventTypeId} of baby {BabyId}", eventTypeId, babyId);
    }

    private async Task<EventType> LoadAsync(Guid babyId, Guid eventTypeId, CancellationToken cancellationToken)
    {
        var eventType = await _eventTypes.FindForUpdateAsync(eventTypeId, cancellationToken);
        return eventType?.IsAvailableTo(babyId) == true ? eventType : throw new EventTypeNotFoundException(babyId, eventTypeId);
    }

    private async Task EnsureKeyFreeAsync(Guid babyId, EventTypeKey key, CancellationToken cancellationToken)
    {
        if (await _eventTypes.KeyExistsAsync(babyId, key, cancellationToken))
        {
            throw new EventTypeKeyTakenException(babyId, key.Value);
        }
    }

    private async Task AddOrThrowAsync(EventType created, CancellationToken cancellationToken)
    {
        if (!await _eventTypes.TryAddAsync(created, cancellationToken))
        {
            throw new EventTypeKeyTakenException(created.BabyId ?? Guid.Empty, created.Key.Value);
        }
    }

    private async Task EnsureUnusedAsync(Guid eventTypeId, CancellationToken cancellationToken)
    {
        if (await _eventTypes.HasEventsAsync(eventTypeId, cancellationToken))
        {
            throw new EventTypeInUseException(eventTypeId);
        }
    }

    private static EventFieldDefinition[] ToDefinitions(IReadOnlyList<EventFieldDefinitionDto>? fields) =>
        (fields ?? []).Select(field => (EventFieldDefinition)field).ToArray();
}
