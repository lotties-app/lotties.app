using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>
/// A past event as seen by the predictions engine: its type key, start, end (<c>null</c> while running), the
/// payload <c>kind</c> when it has one (e.g. <c>nap</c>, <c>bed_time</c> for sleep; see <see cref="SleepKinds"/>), the
/// total of its finished pauses (payload <c>paused_seconds</c>, see <see cref="PauseFields"/>; zero without pauses) and
/// the payload <c>content</c> of a diaper (<c>WET</c>, <c>DIRTY</c>, <c>MIXED</c>; see <see cref="DiaperContents"/>).
/// Callers pass only events that are not soft deleted.
/// </summary>
public sealed record ObservedEvent(EventTypeKey TypeKey, DateTimeOffset StartedAt, DateTimeOffset? EndedAt, string? Kind = null, TimeSpan Paused = default, string? Content = null)
{
    /// <summary>Length without the pauses (<see cref="Events.EffectiveDuration"/>), or <c>null</c> while running.</summary>
    public TimeSpan? EffectiveDuration => EndedAt is { } endedAt ? Events.EffectiveDuration.Of(StartedAt, endedAt, Paused) : null;
}
