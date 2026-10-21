using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Predictions;

namespace BabyRoutine.Domain.Tests.Predictions;

/// <summary>Synthetic event histories shaped like real exports (feeds every ~3h, naps of 1-2h, night wakings).</summary>
internal static class PredictionFixtures
{
    public static readonly EventTypeKey Feeding = BuiltInEventTypes.Feeding.Key;
    public static readonly EventTypeKey Sleep = BuiltInEventTypes.Sleep.Key;
    public static readonly EventTypeKey TummyTime = BuiltInEventTypes.TummyTime.Key;
    public static readonly EventTypeKey Diaper = BuiltInEventTypes.Diaper.Key;

    /// <summary>About two months old at <see cref="TestClock.Now"/> (age band 0-3m).</summary>
    public static readonly DateOnly BirthDate = new(2025, 11, 1);

    public static readonly TimeSpan BrasiliaOffset = TimeSpan.FromHours(-3);

    public static PredictionContext Context(DateTimeOffset? now = null, DateOnly? birthDate = null) =>
        new(birthDate ?? BirthDate, now ?? TestClock.Now);

    public static PredictionSet Predict(IEnumerable<ObservedEvent> events, PredictionContext? context = null) =>
        PredictionEngine.Predict(events, context ?? Context(), PredictionOptions.Default);

    /// <summary>Events every <paramref name="interval"/> from <paramref name="first"/> while the start is at or before <paramref name="last"/>.</summary>
    public static List<ObservedEvent> Every(EventTypeKey key, TimeSpan interval, DateTimeOffset first, DateTimeOffset last, TimeSpan? duration = null)
    {
        var events = new List<ObservedEvent>();
        for (var start = first; start <= last; start += interval)
        {
            events.Add(new ObservedEvent(key, start, start + (duration ?? TimeSpan.Zero)));
        }

        return events;
    }

    /// <summary>
    /// Fifteen days of jittered feeds and sleeps ending at <paramref name="now"/>, in local time <paramref name="offset"/>:
    /// feeds every ~3h by day and ~4h by night lasting 15-30 min; naps of 1-2h after 1.5-2h awake by day; night
    /// sleep in 2-3.5h stretches broken by 20-40 min night wakings.
    /// </summary>
    public static List<ObservedEvent> RealisticHistory(DateTimeOffset now, TimeSpan offset, int seed = 42)
    {
        var random = new Random(seed);
        var start = now.ToOffset(offset).AddDays(-15);
        return [.. Feeds(random, start, now, offset), .. Sleeps(random, start, now, offset)];
    }

    public static IEnumerable<ObservedEvent> Shuffle(IEnumerable<ObservedEvent> events, int seed)
    {
        var random = new Random(seed);
        return events.OrderBy(_ => random.Next()).ToArray();
    }

    private static IEnumerable<ObservedEvent> Feeds(Random random, DateTimeOffset start, DateTimeOffset now, TimeSpan offset)
    {
        for (var feed = start; feed < now; feed += FeedInterval(random, feed, offset))
        {
            var end = feed + Minutes(random, 15, 30);
            yield return new ObservedEvent(Feeding, feed, end <= now ? end : null);
        }
    }

    private static IEnumerable<ObservedEvent> Sleeps(Random random, DateTimeOffset start, DateTimeOffset now, TimeSpan offset)
    {
        var sleep = start;
        while (sleep < now)
        {
            var night = IsNight(sleep, offset);
            var end = sleep + (night ? Minutes(random, 120, 210) : Minutes(random, 60, 120));
            yield return new ObservedEvent(Sleep, sleep, end <= now ? end : null);
            sleep = end + (night ? Minutes(random, 20, 40) : Minutes(random, 90, 120));
        }
    }

    private static TimeSpan FeedInterval(Random random, DateTimeOffset feed, TimeSpan offset) =>
        (IsNight(feed, offset) ? TimeSpan.FromHours(4) : TimeSpan.FromHours(3)) + Minutes(random, -20, 20);

    private static bool IsNight(DateTimeOffset instant, TimeSpan offset) =>
        DayPhases.Of(instant, offset, PredictionOptions.Default) == DayPhase.Night;

    private static TimeSpan Minutes(Random random, int min, int max) => TimeSpan.FromMinutes(random.Next(min, max + 1));
}
