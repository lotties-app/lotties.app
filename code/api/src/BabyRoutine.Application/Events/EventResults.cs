namespace BabyRoutine.Application.Events;

/// <summary>The outcome of an upsert: the event as stored, and whether this request created it.</summary>
public sealed record UpsertEventResult(EventResponse Event, bool Created);

/// <summary>
/// Query of <c>GET /api/v1/babies/{babyId}/events</c>. <see cref="After"/> (a cursor from a previous page) takes
/// precedence over <see cref="Since"/> (inclusive lower bound on <c>updatedAt</c>); with neither, the delta starts
/// from the first event. <see cref="Limit"/> defaults to and is capped at 500.
/// </summary>
public sealed record ListEventChangesRequest(DateTimeOffset? Since, string? After, int? Limit);

/// <summary>
/// One page of the delta, ordered by <c>(updatedAt, id)</c> ascending and including soft-deleted events.
/// <see cref="NextCursor"/> is set when more events follow; pass it back as <c>after</c>.
/// </summary>
public sealed record EventChangesPage(IReadOnlyList<EventResponse> Items, string? NextCursor);
