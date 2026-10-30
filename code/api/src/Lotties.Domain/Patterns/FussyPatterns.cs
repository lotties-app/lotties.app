using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Patterns;

/// <summary>
/// The recurring fussy pattern (the evening "witching hour", docs/design/11-patterns.md section 7):
/// <see cref="RecurringTimeOfDayPattern"/> over the baby's <c>fussy</c> events, and whether today's window is already
/// handled because a fussy spell was logged from <see cref="Lead"/> before the window starts. Same rules as
/// <see cref="BellyPainPatterns"/>; the suggestion and the reminder only point at a pattern in what the family logged,
/// never at a diagnosis or medical advice.
/// </summary>
public static class FussyPatterns
{
    /// <summary>
    /// The Now suggestion shows from this long before the window starts, and a fussy spell logged from then on means the
    /// window was handled.
    /// </summary>
    public static readonly TimeSpan Lead = BellyPainPatterns.Lead;

    public static EventTypeKey TypeKey => BuiltInEventTypes.Fussy.Key;

    /// <summary>The pattern of the fussy events started up to <paramref name="now"/>, in local times of <paramref name="clock"/>.</summary>
    /// <param name="events">Events that are not soft deleted, of any type, in any order.</param>
    public static TimeOfDayPattern? Detect(IEnumerable<ObservedEvent> events, DateTimeOffset now, LocalClock clock, RecurringTimeOfDayOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(clock);
        var localTimes = events
            .Where(item => CountsUpTo(item, now))
            .Select(item => clock.ToLocal(item.StartedAt));
        return RecurringTimeOfDayPattern.Detect(localTimes, clock.DateOf(now), options);
    }

    /// <summary>The start of the latest fussy spell started up to <paramref name="now"/>, if any.</summary>
    public static DateTimeOffset? LastLoggedAt(IEnumerable<ObservedEvent> events, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(events);
        return events
            .Where(item => CountsUpTo(item, now))
            .Select(item => (DateTimeOffset?)item.StartedAt)
            .Max();
    }

    /// <summary>
    /// A fussy spell started up to <paramref name="now"/> that counts as crying: a spell a parent marked "Not crying"
    /// (<see cref="Events.CryDetection.IsConfirmedNotCrying"/>) neither builds the pattern nor handles a window.
    /// </summary>
    private static bool CountsUpTo(ObservedEvent item, DateTimeOffset now) =>
        item.TypeKey == TypeKey && item.StartedAt <= now && !item.ConfirmedNotCrying;

    /// <summary>Whether a fussy spell logged at <paramref name="lastLoggedAt"/> handles the window starting at <paramref name="windowStart"/>.</summary>
    public static bool IsHandled(DateTimeOffset windowStart, DateTimeOffset? lastLoggedAt) =>
        lastLoggedAt is { } logged && logged >= windowStart - Lead;
}
