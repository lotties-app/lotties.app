using BabyRoutine.Domain.Events;

namespace BabyRoutine.Application.Events;

/// <summary>Body of <c>PUT /api/v1/babies/{babyId}/events/{eventId}</c>: the full editable state of the event.</summary>
public sealed record UpsertEventRequest
{
    /// <summary>A built-in event type or a custom type of the baby.</summary>
    public required Guid TypeId { get; init; }

    public required DateTimeOffset StartedAt { get; init; }

    /// <summary><c>null</c> while the event is running.</summary>
    public DateTimeOffset? EndedAt { get; init; }

    /// <summary>A JSON object; omitted or <c>null</c> means <c>{}</c>.</summary>
    public EventPayload Payload { get; init; }

    public string? Notes { get; init; }

    /// <summary>
    /// Optional client time of the edit being pushed, for last-write-wins: when it is older than the stored
    /// <c>updatedAt</c> the upsert is ignored and the stored event is returned. Never stored; the server stamps
    /// <c>updatedAt</c> from its own clock.
    /// </summary>
    public DateTimeOffset? UpdatedAt { get; init; }
}
