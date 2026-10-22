using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Patterns;

/// <summary>
/// The recurring belly pain pattern (docs/design/11-patterns.md): <see cref="RecurringTimeOfDayPattern"/> over the
/// baby's <c>belly_pain</c> events, and whether today's window is already handled because a belly pain or a belly
/// massage was logged from <see cref="Lead"/> before the window starts. The suggestion and the reminder only point at
/// a pattern in what the family logged; they are never medical advice.
/// </summary>
public static class BellyPainPatterns
{
    /// <summary>
    /// The Now suggestion shows from this long before the window starts, and a belly pain or belly massage logged from
    /// then on means the window was handled.
    /// </summary>
    public static readonly TimeSpan Lead = TimeSpan.FromMinutes(45);

    public static EventTypeKey PainTypeKey => BuiltInEventTypes.BellyPain.Key;

    public static EventTypeKey MassageTypeKey => BuiltInEventTypes.BellyMassage.Key;

    /// <summary>The pattern of the belly pain events started up to <paramref name="now"/>, in local times of <paramref name="clock"/>.</summary>
    /// <param name="events">Events that are not soft deleted, of any type, in any order.</param>
    public static TimeOfDayPattern? Detect(IEnumerable<ObservedEvent> events, DateTimeOffset now, LocalClock clock, RecurringTimeOfDayOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(clock);
        var localTimes = events
            .Where(item => item.TypeKey == PainTypeKey && item.StartedAt <= now)
            .Select(item => clock.ToLocal(item.StartedAt));
        return RecurringTimeOfDayPattern.Detect(localTimes, clock.DateOf(now), options);
    }

    /// <summary>The start of the latest belly pain or belly massage started up to <paramref name="now"/>, if any.</summary>
    public static DateTimeOffset? LastLoggedAt(IEnumerable<ObservedEvent> events, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(events);
        return events
            .Where(item => (item.TypeKey == PainTypeKey || item.TypeKey == MassageTypeKey) && item.StartedAt <= now)
            .Select(item => (DateTimeOffset?)item.StartedAt)
            .Max();
    }

    /// <summary>Whether a belly pain or massage logged at <paramref name="lastLoggedAt"/> handles the window starting at <paramref name="windowStart"/>.</summary>
    public static bool IsHandled(DateTimeOffset windowStart, DateTimeOffset? lastLoggedAt) =>
        lastLoggedAt is { } logged && logged >= windowStart - Lead;
}
