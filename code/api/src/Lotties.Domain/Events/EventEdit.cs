namespace Lotties.Domain.Events;

/// <summary>The details an upsert asks a stored event to take (as sent, before normalization).</summary>
public sealed record EventEdit(Guid TypeId, DateTimeOffset StartedAt, DateTimeOffset? EndedAt, EventPayload Payload, string? Notes);
