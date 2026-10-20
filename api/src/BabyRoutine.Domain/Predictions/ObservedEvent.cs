using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Predictions;

/// <summary>
/// A past event as seen by the predictions engine: its type key, start and end (<c>null</c> while running).
/// Callers pass only events that are not soft deleted.
/// </summary>
public sealed record ObservedEvent(EventTypeKey TypeKey, DateTimeOffset StartedAt, DateTimeOffset? EndedAt);
