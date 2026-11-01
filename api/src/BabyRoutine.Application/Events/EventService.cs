using BabyRoutine.Application.Users;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Exceptions;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Application.Events;

/// <remarks>
/// Upserts are idempotent: replaying a request finds the stored event, and an edit with unchanged details does not
/// bump <c>UpdatedAt</c>, so the same request returns the same representation. Last write wins compares the request's
/// client <c>updatedAt</c> with the stored <c>ClientUpdatedAt</c>; the server <c>UpdatedAt</c> stays the sync cursor.
/// Concurrent creates of one client id resolve to a single row: the loser reloads the winner and applies its request as
/// an edit.
/// </remarks>
internal sealed class EventService : IEventService
{
    private readonly IEventRepository _events;
    private readonly IEventTypeRepository _eventTypes;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<EventService> _logger;

    public EventService(
        IEventRepository events,
        IEventTypeRepository eventTypes,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<EventService> logger)
    {
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _eventTypes = eventTypes ?? throw new ArgumentNullException(nameof(eventTypes));
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
        await EnsureTypeAvailableAsync(babyId, request.TypeId, cancellationToken);
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

        await EnsureTypeAvailableAsync(babyId, request.TypeId, cancellationToken);
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

    private async Task EnsureTypeAvailableAsync(Guid babyId, Guid eventTypeId, CancellationToken cancellationToken)
    {
        var eventType = await _eventTypes.FindAsync(eventTypeId, cancellationToken);
        if (eventType?.IsAvailableTo(babyId) != true)
        {
            throw new EventTypeNotAvailableException(eventTypeId, babyId);
        }
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
