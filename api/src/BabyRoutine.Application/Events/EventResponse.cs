using BabyRoutine.Domain.Events;

namespace BabyRoutine.Application.Events;

/// <summary>An event as returned by the events endpoints. Soft-deleted events carry <see cref="DeletedAt"/>.</summary>
public sealed record EventResponse
{
    public Guid Id { get; init; }

    public Guid BabyId { get; init; }

    public Guid TypeId { get; init; }

    public DateTimeOffset StartedAt { get; init; }

    public DateTimeOffset? EndedAt { get; init; }

    /// <summary>A JSON object (serialized as JSON, not as a string).</summary>
    public EventPayload Payload { get; init; }

    public string? Notes { get; init; }

    public Guid CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    /// <summary>Server time of the last change; authoritative for sync.</summary>
    public DateTimeOffset UpdatedAt { get; init; }

    public DateTimeOffset? DeletedAt { get; init; }

    public static implicit operator EventResponse(Event stored)
    {
        ArgumentNullException.ThrowIfNull(stored);
        return new EventResponse
        {
            Id = stored.Id,
            BabyId = stored.BabyId,
            TypeId = stored.TypeId,
            StartedAt = stored.StartedAt,
            EndedAt = stored.EndedAt,
            Payload = stored.Payload,
            Notes = stored.Notes,
            CreatedBy = stored.CreatedBy,
            CreatedAt = stored.CreatedAt,
            UpdatedAt = stored.UpdatedAt,
            DeletedAt = stored.DeletedAt,
        };
    }
}
