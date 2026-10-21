namespace Lotties.Domain.Predictions;

/// <summary>Values of the sleep payload <c>kind</c> field the predictions engine interprets.</summary>
public static class SleepKinds
{
    public const string Nap = "nap";
    public const string Night = "night";
    public const string NightWaking = "night_waking";
    public const string BedTime = "bed_time";
    public const string WokeUp = "woke_up";
    public const string FellAsleep = "fell_asleep";
}

/// <summary>
/// Turns the logged events of the sleep type into sleep sessions, the input of the awake-window prediction:
/// <list type="bullet">
/// <item>events without a kind (or an unknown kind), <c>nap</c> and <c>night</c> are sessions as logged;</item>
/// <item><c>night_waking</c> episodes are not sleep and are dropped, so they neither count as sessions nor split the
/// night into short awake windows;</item>
/// <item>the instant markers <c>bed_time</c> and <c>woke_up</c> form a night session from a bed time to the next
/// marker when that is a wake-up at most <see cref="PredictionOptions.MaxNightSessionLength"/> later; a bed time
/// followed by another bed time, or a wake-up without a bed time, is ignored. A bed time that is the last marker and
/// within that length of now is a night still in progress (running session);</item>
/// <item>the instant marker <c>fell_asleep</c> is never a session nor a night boundary; a nap or night timer that
/// starts within <see cref="FellAsleepTimerWindow"/> after one and inside a bed-time night is that same sleep and is
/// absorbed by the night, so it is not counted twice.</item>
/// </list>
/// </summary>
internal static class SleepSessions
{
    /// <summary>How soon after a <c>fell_asleep</c> marker a started timer is considered the same sleep.</summary>
    public static readonly TimeSpan FellAsleepTimerWindow = TimeSpan.FromMinutes(5);

    public static IEnumerable<ObservedEvent> Build(IReadOnlyList<ObservedEvent> sleepEvents, DateTimeOffset now, TimeSpan maxNightLength)
    {
        var fellAsleep = sleepEvents.Where(item => item.Kind == SleepKinds.FellAsleep).ToArray();
        var markers = sleepEvents
            .Where(IsMarker)
            .OrderBy(item => item.StartedAt)
            .ThenBy(item => item.Kind == SleepKinds.BedTime ? 1 : 0)
            .ToArray();
        var nights = markers
            .Zip(markers.Skip(1).Cast<ObservedEvent?>().Append(null))
            .Select(pair => NightOrNull(pair.First, pair.Second, now, maxNightLength))
            .OfType<ObservedEvent>();
        var nightList = nights.ToArray();
        var logged = sleepEvents
            .Where(IsLoggedSession)
            .Where(item => !IsTimerAbsorbedByNight(item, fellAsleep, nightList, now));
        return logged.Concat(nightList);
    }

    private static bool IsTimerAbsorbedByNight(ObservedEvent timer, IReadOnlyList<ObservedEvent> fellAsleep, IReadOnlyList<ObservedEvent> nights, DateTimeOffset now) =>
        fellAsleep.Any(marker => StartsRightAfter(timer, marker)) && nights.Any(night => StartsInside(timer, night, now));

    private static bool StartsRightAfter(ObservedEvent timer, ObservedEvent marker) =>
        timer.StartedAt >= marker.StartedAt && timer.StartedAt - marker.StartedAt <= FellAsleepTimerWindow;

    private static bool StartsInside(ObservedEvent timer, ObservedEvent night, DateTimeOffset now) =>
        timer.StartedAt >= night.StartedAt && timer.StartedAt < (night.EndedAt ?? now);

    private static bool IsLoggedSession(ObservedEvent item) =>
        item.Kind is not (SleepKinds.NightWaking or SleepKinds.BedTime or SleepKinds.WokeUp or SleepKinds.FellAsleep);

    private static bool IsMarker(ObservedEvent item) => item.Kind is SleepKinds.BedTime or SleepKinds.WokeUp;

    private static ObservedEvent? NightOrNull(ObservedEvent marker, ObservedEvent? next, DateTimeOffset now, TimeSpan maxNightLength) => (marker.Kind, next) switch
    {
        (not SleepKinds.BedTime, _) => null,
        (_, null) => now - marker.StartedAt <= maxNightLength ? Night(marker, null) : null,
        (_, { Kind: SleepKinds.WokeUp }) when next.StartedAt - marker.StartedAt <= maxNightLength => Night(marker, next.StartedAt),
        _ => null,
    };

    private static ObservedEvent Night(ObservedEvent bedTime, DateTimeOffset? wokeAt) => bedTime with { EndedAt = wokeAt, Kind = SleepKinds.Night };
}
