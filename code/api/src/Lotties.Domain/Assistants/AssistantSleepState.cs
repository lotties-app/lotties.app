using Lotties.Domain.Events;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Assistants;

/// <summary>Whether the baby sleeps, is awake, or nothing was logged to tell.</summary>
public enum AssistantSleepPhase
{
    Unknown,
    Awake,
    Asleep,
}

/// <summary>
/// What the sleep log says now, as the web's Now state does (<c>deriveNowState</c>): <see cref="Since"/> is when the
/// sleep started (asleep, a running timer or a lone <c>fell_asleep</c> marker) or the last wake (awake).
/// <see cref="RunningNightWakingSince"/> is a night waking that started inside the running sleep (she is up in the night),
/// <see cref="NightWakingSinceWake"/> tells that a night waking ended at or after the last wake (or still runs), and
/// <see cref="LastSleepEventAt"/> is the latest end (else start) of any sleep event (the nap window goes stale 24 hours after it).
/// </summary>
public sealed record AssistantSleepState(
    AssistantSleepPhase Phase,
    DateTimeOffset? Since,
    DateTimeOffset? RunningNightWakingSince,
    bool NightWakingSinceWake,
    DateTimeOffset? LastSleepEventAt)
{
    /// <summary>A lone <c>fell_asleep</c> marker older than this no longer means asleep (as on Now and in the wake window).</summary>
    public static readonly TimeSpan LoneMarkerMaxAge = TimeSpan.FromHours(16);

    /// <param name="sleepEvents">The baby's sleep events that are not soft deleted, in any order; events after <paramref name="now"/> are ignored.</param>
    public static AssistantSleepState Of(IEnumerable<Event> sleepEvents, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(sleepEvents);
        var past = sleepEvents.Where(stored => !stored.IsDeleted && stored.StartedAt <= now).ToArray();
        var lastEvent = past.Select(stored => stored.EndedAt ?? stored.StartedAt).Cast<DateTimeOffset?>().Max();
        if (past.FirstOrDefault(AssistantEventFacts.IsRunningSleepTimer) is { } running)
        {
            return new AssistantSleepState(AssistantSleepPhase.Asleep, running.StartedAt, NightWakingInside(past, running.StartedAt), false, lastEvent);
        }

        var since = LastWake(past);
        if (LoneFellAsleep(past, since, now) is { } marker)
        {
            return new AssistantSleepState(AssistantSleepPhase.Asleep, marker.StartedAt, null, false, lastEvent);
        }

        return since is { } wake
            ? new AssistantSleepState(AssistantSleepPhase.Awake, wake, null, NightWakingSince(past, wake), lastEvent)
            : new AssistantSleepState(AssistantSleepPhase.Unknown, null, null, false, lastEvent);
    }

    /// <summary>The latest end of a finished sleep timer or the latest <c>woke_up</c> marker.</summary>
    private static DateTimeOffset? LastWake(IReadOnlyList<Event> past)
    {
        var ends = past.Where(AssistantEventFacts.IsSleepTimer).Where(stored => stored.EndedAt is not null).Select(stored => stored.EndedAt);
        var wakeUps = past.Where(stored => KindOf(stored) == SleepKinds.WokeUp).Select(stored => (DateTimeOffset?)stored.StartedAt);
        return ends.Concat(wakeUps).Max();
    }

    private static Event? LoneFellAsleep(IReadOnlyList<Event> past, DateTimeOffset? since, DateTimeOffset now) =>
        past.Where(stored => KindOf(stored) == SleepKinds.FellAsleep && (since is null || stored.StartedAt > since) && now - stored.StartedAt <= LoneMarkerMaxAge)
            .MaxBy(stored => stored.StartedAt);

    private static DateTimeOffset? NightWakingInside(IReadOnlyList<Event> past, DateTimeOffset sleepStartedAt) =>
        past.Where(stored => AssistantEventFacts.IsRunningNightWaking(stored) && stored.StartedAt >= sleepStartedAt)
            .Select(stored => (DateTimeOffset?)stored.StartedAt)
            .Min();

    private static bool NightWakingSince(IReadOnlyList<Event> past, DateTimeOffset since) =>
        past.Any(stored => KindOf(stored) == SleepKinds.NightWaking && (stored.EndedAt is null || stored.EndedAt >= since));

    private static string? KindOf(Event stored) => EventPayloadFacts.Read(stored.Payload).Kind;
}
