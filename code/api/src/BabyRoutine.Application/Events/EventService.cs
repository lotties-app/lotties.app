using BabyRoutine.Application.Users;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Prescriptions;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Application.Events;

/// <remarks>
/// Upserts are idempotent: replaying a request finds the stored event, and an edit with unchanged details does not
/// bump <c>UpdatedAt</c>, so the same request returns the same representation. Last write wins compares the request's
/// client <c>updatedAt</c> with the stored <c>ClientUpdatedAt</c>; the server <c>UpdatedAt</c> stays the sync cursor.
/// Concurrent creates of one client id resolve to a single row: the loser reloads the winner and applies its request as
/// an edit. Payloads are checked against the type's field definitions (<see cref="EventType.EnsureValidPayload"/>) on
/// create and on every edit that changes the type or payload or completes a running event, so an unchanged legacy
/// payload never blocks an edit of times or notes. Built-in medication events are checked at the same moments for the
/// prescription members of their entries (<see cref="MedicationDosePayload"/>): a referenced prescription must be one of
/// the baby's (soft-deleted included) for the entry's medication.
/// </remarks>
internal sealed class EventService : IEventService
{
    private readonly IEventRepository _events;
    private readonly IEventTypeRepository _eventTypes;
    private readonly IPrescriptionRepository _prescriptions;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<EventService> _logger;

    public EventService(
        IEventRepository events,
        IEventTypeRepository eventTypes,
        IPrescriptionRepository prescriptions,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<EventService> logger)
    {
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _eventTypes = eventTypes ?? throw new ArgumentNullException(nameof(eventTypes));
        _prescriptions = prescriptions ?? throw new ArgumentNullException(nameof(prescriptions));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<UpsertEventResult> UpsertAsync(Guid babyId, Guid eventId, UpsertEventRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureEventId(eventId);
        var existing = await _events.FindAsync(eventId, cancellationToken);
        return existing is null
            ? await CreateAsync(babyId, eventId, request, cancellationToken)
            : await UpdateAsync(babyId, existing, request, cancellationToken);
    }

    public async Task DeleteAsync(Guid babyId, Guid eventId, CancellationToken cancellationToken = default)
    {
        var existing = await _events.FindForBabyAsync(babyId, eventId, cancellationToken);
        if (existing is null)
        {
            _logger.LogDebug("Delete of unknown event {EventId} for baby {BabyId} is a no-op", eventId, babyId);
            return;
        }

        existing.SoftDelete(_timeProvider.GetUtcNow());
        await _events.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Soft deleted event {EventId} of baby {BabyId}", eventId, babyId);
    }

    public async Task<EventResponse> GetAsync(Guid babyId, Guid eventId, CancellationToken cancellationToken = default) =>
        await _events.FindForBabyAsync(babyId, eventId, cancellationToken) ?? throw new EventNotFoundException(babyId, eventId);

    public async Task<EventChangesPage> ListChangesAsync(Guid babyId, ListEventChangesRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var pageSize = EventSyncPageSize.From(request.Limit);
        var fetched = await _events.ListChangesAsync(babyId, StartingPoint(request), pageSize.Value + 1, cancellationToken);
        return BuildPage(fetched, pageSize);
    }

    private async Task<UpsertEventResult> CreateAsync(Guid babyId, Guid eventId, UpsertEventRequest request, CancellationToken cancellationToken)
    {
        var eventType = await LoadAvailableTypeAsync(babyId, request.TypeId, cancellationToken);
        eventType.EnsureValidPayload(request.Payload, request.StartedAt, request.EndedAt);
        await EnsurePrescriptionReferencesAsync(babyId, request, cancellationToken);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var created = Event.Create(
            eventId,
            babyId,
            request.TypeId,
            user.Id,
            request.StartedAt,
            request.EndedAt,
            request.Payload,
            request.Notes,
            _timeProvider.GetUtcNow(),
            request.UpdatedAt);
        return await _events.TryAddAsync(created, cancellationToken)
            ? Created(created)
            : await UpdateAsync(babyId, await FindConcurrentWinnerAsync(eventId, cancellationToken), request, cancellationToken);
    }

    private async Task<UpsertEventResult> UpdateAsync(Guid babyId, Event existing, UpsertEventRequest request, CancellationToken cancellationToken)
    {
        var now = _timeProvider.GetUtcNow();
        var decision = existing.DecideUpsert(babyId, request.UpdatedAt, now);
        if (decision != EventUpsertDecision.Apply)
        {
            _logger.LogInformation("Upsert of event {EventId} ignored: {Decision}", existing.Id, decision);
            return new UpsertEventResult(existing, Created: false);
        }

        var eventType = await LoadAvailableTypeAsync(babyId, request.TypeId, cancellationToken);
        await EnsureValidEditPayloadAsync(babyId, existing, eventType, request, cancellationToken);
        existing.Edit(request.TypeId, request.StartedAt, request.EndedAt, request.Payload, request.Notes, now, request.UpdatedAt);
        await _events.SaveChangesAsync(cancellationToken);
        return new UpsertEventResult(existing, Created: false);
    }

    private UpsertEventResult Created(Event created)
    {
        _logger.LogInformation("Created event {EventId} of type {EventTypeId} for baby {BabyId}", created.Id, created.TypeId, created.BabyId);
        return new UpsertEventResult(created, Created: true);
    }

    private async Task<Event> FindConcurrentWinnerAsync(Guid eventId, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Event {EventId} was created concurrently; applying the request as an edit", eventId);
        return await _events.FindAsync(eventId, cancellationToken)
            ?? throw new InvalidOperationException($"Event {eventId} was reported as existing but could not be loaded.");
    }

    private async Task<EventType> LoadAvailableTypeAsync(Guid babyId, Guid eventTypeId, CancellationToken cancellationToken)
    {
        var eventType = await _eventTypes.FindAsync(eventTypeId, cancellationToken);
        return eventType?.IsAvailableTo(babyId) == true ? eventType : throw new EventTypeNotAvailableException(eventTypeId, babyId);
    }

    private async Task EnsureValidEditPayloadAsync(Guid babyId, Event existing, EventType eventType, UpsertEventRequest request, CancellationToken cancellationToken)
    {
        if (!existing.NeedsPayloadCheck(request.TypeId, request.Payload, request.EndedAt))
        {
            return;
        }

        eventType.EnsureValidPayload(request.Payload, request.StartedAt, request.EndedAt);
        await EnsurePrescriptionReferencesAsync(babyId, request, cancellationToken);
    }

    private async Task EnsurePrescriptionReferencesAsync(Guid babyId, UpsertEventRequest request, CancellationToken cancellationToken)
    {
        var references = request.TypeId == BuiltInEventTypes.MedicationId ? MedicationDosePayload.CheckExtensions(request.Payload) : [];
        if (references.Count == 0)
        {
            return;
        }

        var found = await _prescriptions.FindManyAsync(references.Select(reference => reference.PrescriptionId).ToArray(), cancellationToken);
        MedicationDosePayload.EnsureReferencesValid(babyId, references, found);
    }

    private static EventSyncCursor? StartingPoint(ListEventChangesRequest request) => request switch
    {
        { After: not null } => EventSyncCursor.From(request.After),
        { Since: { } since } => EventSyncCursor.AtOrAfter(since),
        _ => null,
    };

    private static EventChangesPage BuildPage(IReadOnlyList<Event> fetched, EventSyncPageSize pageSize)
    {
        var items = fetched.Take(pageSize.Value).Select(stored => (EventResponse)stored).ToArray();
        var nextCursor = fetched.Count > pageSize.Value ? EventSyncCursor.After(fetched[pageSize.Value - 1]).Value : null;
        return new EventChangesPage(items, nextCursor);
    }

    private static void EnsureEventId(Guid eventId)
    {
        if (eventId == Guid.Empty)
        {
            throw new DomainValidationException("eventId", "The event id must be a non-empty GUID generated by the client.");
        }
    }
}
