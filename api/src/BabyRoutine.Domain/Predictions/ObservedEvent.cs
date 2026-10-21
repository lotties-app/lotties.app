using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Predictions;

/// <summary>
/// A past event as seen by the predictions engine: its type key, start, end (<c>null</c> while running) and the
/// payload <c>kind</c> when it has one (e.g. <c>nap</c>, <c>bed_time</c> for sleep; see <see cref="SleepKinds"/>).
/// Callers pass only events that are not soft deleted.
/// </summary>
public sealed record ObservedEvent(EventTypeKey TypeKey, DateTimeOffset StartedAt, DateTimeOffset? EndedAt, string? Kind = null);
