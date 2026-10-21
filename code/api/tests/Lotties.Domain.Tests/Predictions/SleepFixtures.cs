using Lotties.Domain.Predictions;
using static Lotties.Domain.Tests.Predictions.PredictionFixtures;

namespace Lotties.Domain.Tests.Predictions;

/// <summary>
/// Synthetic sleep histories in local time -03:00, shaped like the fixture night of <see cref="SleepSessionTests"/>:
/// woke up 06:30, naps 09:00-10:00, 12:30-14:00 and 16:00-17:00, bed time 20:00, a night waking 02:00-02:20.
/// </summary>
internal static class SleepFixtures
{
    public static readonly DateTimeOffset Today = new(2026, 1, 10, 0, 0, 0, BrasiliaOffset);

    public static DateTimeOffset At(int dayOffset, int hour, int minute = 0) => Today.AddDays(dayOffset).AddHours(hour).AddMinutes(minute);

    public static ObservedEvent Marker(string kind, DateTimeOffset at) => new(Sleep, at, at, kind);

    public static ObservedEvent Logged(string? kind, DateTimeOffset start, DateTimeOffset? end) => new(Sleep, start, end, kind);

    /// <summary>Seven fixture days before today, then today's morning wake-up and naps, keeping what ended by <paramref name="now"/>.</summary>
    public static List<ObservedEvent> FixtureDays(DateTimeOffset now) =>
        Enumerable.Range(-7, 8)
            .SelectMany(FixtureDay)
            .Where(item => (item.EndedAt ?? item.StartedAt) <= now)
            .ToList();

    public static IEnumerable<ObservedEvent> FixtureDay(int day) =>
    [
        Marker(SleepKinds.WokeUp, At(day, 6, 30)),
        Logged(SleepKinds.Nap, At(day, 9), At(day, 10)),
        Logged(SleepKinds.Nap, At(day, 12, 30), At(day, 14)),
        Logged(SleepKinds.Nap, At(day, 16), At(day, 17)),
        Marker(SleepKinds.BedTime, At(day, 20)),
        Logged(SleepKinds.NightWaking, At(day + 1, 2), At(day + 1, 2, 20)),
    ];

    /// <summary>A bed time at <paramref name="bedHour"/>:<paramref name="bedMinute"/> local on <paramref name="day"/> and the wake-up 10 hours later.</summary>
    public static IEnumerable<ObservedEvent> Night(int day, int bedHour, int bedMinute = 0)
    {
        var bedTime = At(day, bedHour, bedMinute);
        return [Marker(SleepKinds.BedTime, bedTime), Marker(SleepKinds.WokeUp, bedTime.AddHours(10))];
    }

    public static Prediction PredictSleep(IEnumerable<ObservedEvent> events, DateTimeOffset now) =>
        Assert.Single(Predict(events, Context(now)).Predictions, prediction => prediction.TypeKey == Sleep);
}
