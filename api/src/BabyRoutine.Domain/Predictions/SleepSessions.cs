namespace BabyRoutine.Domain.Predictions;

/// <summary>Values of the sleep payload <c>kind</c> field the predictions engine interprets.</summary>
public static class SleepKinds
{
    public const string Nap = "nap";
    public const string Night = "night";
    public const string NightWaking = "night_waking";
    public const string BedTime = "bed_time";
    public const string WokeUp = "woke_up";
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
/// within that length of now is a night still in progress (running session).</item>
/// </list>
/// </summary>
internal static class SleepSessions
{
    public static IEnumerable<ObservedEvent> Build(IReadOnlyList<ObservedEvent> sleepEvents, DateTimeOffset now, TimeSpan maxNightLength)
    {
        var logged = sleepEvents.Where(IsLoggedSession);
        var markers = sleepEvents
            .Where(IsMarker)
            .OrderBy(item => item.StartedAt)
            .ThenBy(item => item.Kind == SleepKinds.BedTime ? 1 : 0)
            .ToArray();
        var nights = markers
            .Zip(markers.Skip(1).Cast<ObservedEvent?>().Append(null))
            .Select(pair => NightOrNull(pair.First, pair.Second, now, maxNightLength))
            .OfType<ObservedEvent>();
        return logged.Concat(nights);
    }

    private static bool IsLoggedSession(ObservedEvent item) =>
        item.Kind is not (SleepKinds.NightWaking or SleepKinds.BedTime or SleepKinds.WokeUp);

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
