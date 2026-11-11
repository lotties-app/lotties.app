using Lotties.Application.Babies;
using Lotties.Application.SilentPush;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Formulas;
using Lotties.Domain.Prescriptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Events;

/// <remarks>
/// Upserts are idempotent: replaying a request finds the stored event, and an edit with unchanged details does not
/// bump <c>UpdatedAt</c>, so the same request returns the same representation. Last write wins compares the request's
/// client <c>updatedAt</c> with the stored <c>ClientUpdatedAt</c>; the server <c>UpdatedAt</c> stays the sync cursor.
/// Concurrent creates of one client id resolve to a single row: the loser reloads the winner and applies its request as
/// an edit. Payloads are checked against the type's field definitions (<see cref="EventType.EnsureValidPayload"/>) on
/// create and on every edit that changes the type or payload or completes a running event, so an unchanged legacy
/// payload never blocks an edit of times or notes. Built-in medication events are checked at the same moments for the
/// prescription members of their entries (<see cref="MedicationDosePayload"/>): a referenced prescription must be one of
/// the baby's (soft-deleted included) for the entry's medication, and built-in feeding events for their formula
/// (<see cref="FormulaPayload"/>): a referenced formula must be one of the baby's (archived included). Every write to a stored event (edit or delete, no-ops
/// included) checks that the caller may change it: a Caregiver changes only the events they logged, except that they may
/// stop, pause or resume someone else's running event (<see cref="Event.EnsureEditableBy"/>, deletes
/// <see cref="Event.EnsureChangeableBy"/>); creating needs only the role the endpoint policy already checked. Reads go
/// through the caller's <see cref="SectionView"/>: a Doctor without the medications section gets no medication doses (404
/// for one), and without the formulas section no formula on a bottle. Every write that changed the store (a create, an
/// applied edit, a soft delete) tells <see cref="ISilentPushSignal"/>, so the family's other phones refresh their widgets
/// (docs/design/37b-widget-silent-push.md section 4.2); an ignored upsert tells nothing.
/// </remarks>
internal sealed class EventService : IEventService
{
    private readonly IEventRepository _events;
    private readonly IEventTypeRepository _eventTypes;
    private readonly IPrescriptionRepository _prescriptions;
    private readonly IFormulaRepository _formulas;
    private readonly IBabyMembershipRepository _memberships;
    private readonly IBabyAccessService _access;
    private readonly ICurrentUser _currentUser;
    private readonly ISilentPushSignal _silentPush;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<EventService> _logger;

    public EventService(
        IEventRepository events,
        IEventTypeRepository eventTypes,
        IPrescriptionRepository prescriptions,
        IFormulaRepository formulas,
        IBabyMembershipRepository memberships,
        IBabyAccessService access,
        ICurrentUser currentUser,
        ISilentPushSignal silentPush,
        TimeProvider timeProvider,
        ILogger<EventService> logger)
    {
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _eventTypes = eventTypes ?? throw new ArgumentNullException(nameof(eventTypes));
        _prescriptions = prescriptions ?? throw new ArgumentNullException(nameof(prescriptions));
        _formulas = formulas ?? throw new ArgumentNullException(nameof(formulas));
        _memberships = memberships ?? throw new ArgumentNullException(nameof(memberships));
        _access = access ?? throw new ArgumentNullException(nameof(access));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _silentPush = silentPush ?? throw new ArgumentNullException(nameof(silentPush));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<UpsertEventResult> UpsertAsync(Guid babyId, Guid eventId, UpsertEventRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureEventId(eventId);
        request = WithHistoryTotals(request);
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

        var userId = await EnsureCallerMayChangeAsync(existing, cancellationToken);
        var before = existing.UpdatedAt;
        existing.SoftDelete(_timeProvider.GetUtcNow());
        await _events.SaveChangesAsync(cancellationToken);
        SignalIfChanged(existing, before, userId);
        _logger.LogInformation("Soft deleted event {EventId} of baby {BabyId}", eventId, babyId);
    }

    public async Task<EventResponse> GetAsync(Guid babyId, Guid eventId, CancellationToken cancellationToken = default)
    {
        var view = await _access.ViewOfCallerAsync(babyId, cancellationToken);
        var stored = await _events.FindForBabyAsync(babyId, eventId, cancellationToken);
        return stored is not null && view.Shows(stored) ? EventResponse.In(stored, view) : throw new EventNotFoundException(babyId, eventId);
    }

    public async Task<EventChangesPage> ListChangesAsync(Guid babyId, ListEventChangesRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var view = await _access.ViewOfCallerAsync(babyId, cancellationToken);
        var pageSize = EventSyncPageSize.From(request.Limit);
        var fetched = await _events.ListChangesAsync(babyId, StartingPoint(request), pageSize.Value + 1, cancellationToken);
        return BuildPage(fetched, pageSize, view);
    }

    private async Task<UpsertEventResult> CreateAsync(Guid babyId, Guid eventId, UpsertEventRequest request, CancellationToken cancellationToken)
    {
        var eventType = await LoadAvailableTypeAsync(babyId, request.TypeId, cancellationToken);
        eventType.EnsureValidPayload(request.Payload, request.StartedAt, request.EndedAt);
        await EnsurePayloadReferencesAsync(babyId, request, cancellationToken);
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
        var userId = await EnsureCallerMayEditAsync(existing, request, now, cancellationToken);
        if (decision != EventUpsertDecision.Apply)
        {
            _logger.LogInformation("Upsert of event {EventId} ignored: {Decision}", existing.Id, decision);
            return new UpsertEventResult(existing, Created: false);
        }

        var eventType = await LoadAvailableTypeAsync(babyId, request.TypeId, cancellationToken);
        await EnsureValidEditPayloadAsync(babyId, existing, eventType, request, cancellationToken);
        var before = existing.UpdatedAt;
        existing.Edit(request.TypeId, request.StartedAt, request.EndedAt, request.Payload, request.Notes, now, request.UpdatedAt);
        await _events.SaveChangesAsync(cancellationToken);
        SignalIfChanged(existing, before, userId);
        return new UpsertEventResult(existing, Created: false);
    }

    /// <summary>Throws when the caller may not change <paramref name="existing"/>; returns the caller's user id.</summary>
    private async Task<Guid> EnsureCallerMayChangeAsync(Event existing, CancellationToken cancellationToken)
    {
        var (userId, role) = await CallerRoleAsync(existing.BabyId, cancellationToken);
        existing.EnsureChangeableBy(userId, role);
        return userId;
    }

    /// <summary>Throws when the caller may not make this edit of <paramref name="existing"/>; returns the caller's user id.</summary>
    private async Task<Guid> EnsureCallerMayEditAsync(Event existing, UpsertEventRequest request, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var (userId, role) = await CallerRoleAsync(existing.BabyId, cancellationToken);
        existing.EnsureEditableBy(userId, role, new EventEdit(request.TypeId, request.StartedAt, request.EndedAt, request.Payload, request.Notes), now);
        return userId;
    }

    private async Task<(Guid UserId, BabyRole? Role)> CallerRoleAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var member = await _memberships.FindAsync(babyId, user.Id, cancellationToken);
        return (user.Id, member?.Role);
    }

    /// <summary>Tells the silent push signal when the write changed the stored event (an unchanged edit or a repeated delete keeps <c>UpdatedAt</c>).</summary>
    private void SignalIfChanged(Event stored, DateTimeOffset updatedAtBefore, Guid userId)
    {
        if (stored.UpdatedAt != updatedAtBefore)
        {
            _silentPush.BabyChanged(stored.BabyId, userId);
        }
    }

    private UpsertEventResult Created(Event created)
    {
        _silentPush.BabyChanged(created.BabyId, created.CreatedBy);
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
        await EnsurePayloadReferencesAsync(babyId, request, cancellationToken);
    }

    private async Task EnsurePayloadReferencesAsync(Guid babyId, UpsertEventRequest request, CancellationToken cancellationToken)
    {
        await EnsurePrescriptionReferencesAsync(babyId, request, cancellationToken);
        await EnsureFormulaReferenceAsync(babyId, request, cancellationToken);
        if (request.TypeId == BuiltInEventTypes.FeedingId)
        {
            BottleAmounts.EnsureDrunkWithinPrepared(request.Payload);
            BottleSegments.EnsureValid(
                request.Payload,
                ended: request.EndedAt is not null,
                request.EndedAt is { } end ? BottleHistory.LengthSeconds(request.StartedAt, end) : null);
        }
    }

    /// <summary>
    /// A built-in bottle's pause totals recomputed from its history (docs/design/44-bottle-history.md: the history is the
    /// source, so a client that wrote other totals, an older app or an assistant's stop, never stores a disagreement).
    /// </summary>
    private static UpsertEventRequest WithHistoryTotals(UpsertEventRequest request) =>
        request.TypeId == BuiltInEventTypes.FeedingId
            ? request with { Payload = BottleHistory.WithTotals(request.Payload, request.StartedAt, request.EndedAt) }
            : request;

    private async Task EnsureFormulaReferenceAsync(Guid babyId, UpsertEventRequest request, CancellationToken cancellationToken)
    {
        var formulaId = request.TypeId == BuiltInEventTypes.FeedingId ? FormulaPayload.CheckReference(request.Payload) : null;
        if (formulaId is not { } id)
        {
            return;
        }

        FormulaPayload.EnsureReferenceValid(babyId, id, await _formulas.FindAsync(id, cancellationToken));
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

    /// <summary>
    /// The page of <paramref name="view"/>: events it does not show are left out of the items (the cursor still moves past
    /// them, so a page may be empty and still have a next one).
    /// </summary>
    private static EventChangesPage BuildPage(IReadOnlyList<Event> fetched, EventSyncPageSize pageSize, SectionView view)
    {
        var items = fetched.Take(pageSize.Value).Where(view.Shows).Select(stored => EventResponse.In(stored, view)).ToArray();
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
