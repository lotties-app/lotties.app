using BabyRoutine.Domain.Predictions;
using static BabyRoutine.Domain.Tests.Predictions.PredictionFixtures;

namespace BabyRoutine.Domain.Tests.Predictions;

/// <summary>
/// Sleep predictions built from the payload <c>kind</c>: the fixture night of the Napper sample export (bed 20:00,
/// night waking 02:00-02:20, woke up 06:30, local -03:00) plus naps 09:00-10:00, 12:30-14:00 and 16:00-17:00.
/// </summary>
public sealed class SleepSessionTests
{
    private static readonly DateTimeOffset Today = new(2026, 1, 10, 0, 0, 0, BrasiliaOffset);

    private static DateTimeOffset At(int dayOffset, int hour, int minute = 0) => Today.AddDays(dayOffset).AddHours(hour).AddMinutes(minute);

    private static ObservedEvent Marker(string kind, DateTimeOffset at) => new(Sleep, at, at, kind);

    private static ObservedEvent Logged(string? kind, DateTimeOffset start, DateTimeOffset? end) => new(Sleep, start, end, kind);

    /// <summary>Seven fixture days before today, then today's morning wake-up and naps that end before <paramref name="now"/>.</summary>
    private static List<ObservedEvent> FixtureDays(DateTimeOffset now)
    {
        var events = new List<ObservedEvent>();
        for (var day = -7; day <= 0; day++)
        {
            events.AddRange(Day(day));
        }

        return events.Where(item => (item.EndedAt ?? item.StartedAt) <= now).ToList();
    }

    private static IEnumerable<ObservedEvent> Day(int day) =>
    [
        Marker(SleepKinds.WokeUp, At(day, 6, 30)),
        Logged(SleepKinds.Nap, At(day, 9), At(day, 10)),
        Logged(SleepKinds.Nap, At(day, 12, 30), At(day, 14)),
        Logged(SleepKinds.Nap, At(day, 16), At(day, 17)),
        Marker(SleepKinds.BedTime, At(day, 20)),
        Logged(SleepKinds.NightWaking, At(day + 1, 2), At(day + 1, 2, 20)),
    ];

    private static Prediction PredictSleep(IEnumerable<ObservedEvent> events, DateTimeOffset now) =>
        Assert.Single(Predict(events, Context(now)).Predictions, prediction => prediction.TypeKey == Sleep);

    [Fact]
    public void Predict_Evening_AwakeWindowIgnoresNightWakingsAndNightLastsFromBedToWakeUp()
    {
        var now = At(0, 18);

        var prediction = PredictSleep(FixtureDays(now), now);

        Assert.Equal(PredictionBasis.AwakeWindow, prediction.Reason.Basis);
        Assert.Equal(TimeSpan.FromHours(2.5), prediction.Reason.MedianGap);
        Assert.Equal(At(0, 19, 30), prediction.NextStart.Expected);
        Assert.Equal(TimeSpan.FromHours(10.5), prediction.ExpectedDuration!.Median);
    }

    [Fact]
    public void Predict_AfterBedTime_TreatsTheNightAsInProgressUntilTheTypicalWakeUp()
    {
        var now = At(0, 23);
        var prediction = PredictSleep(FixtureDays(now), now);

        Assert.True(prediction.Reason.AssumesEventInProgressEnds);
        Assert.Equal(At(1, 9), prediction.NextStart.Expected);
        Assert.Equal(TimeSpan.FromHours(1), prediction.ExpectedDuration!.Median);
    }

    [Fact]
    public void Predict_MorningAfterWakeUp_MeasuresFromTheWakeUpNotFromTheNightWaking()
    {
        var now = At(0, 8);

        var prediction = PredictSleep(FixtureDays(now), now);

        Assert.False(prediction.Reason.AssumesEventInProgressEnds);
        Assert.Equal(TimeSpan.FromHours(2.5), prediction.Reason.MedianGap);
        Assert.Equal(At(0, 9), prediction.NextStart.Expected);
    }

    [Fact]
    public void Predict_OnlyNightWakings_ReportsInsufficientDataWithoutSessions()
    {
        var events = Enumerable.Range(1, 5).Select(day => Logged(SleepKinds.NightWaking, At(-day, 2), At(-day, 2, 20)));

        var result = Predict(events, Context(At(0, 12)));

        Assert.Empty(result.Predictions);
        Assert.Equal((Sleep, 0), (Assert.Single(result.InsufficientData).TypeKey, result.InsufficientData[0].SampleCount));
    }

    [Theory]
    [InlineData(15, 4)]
    [InlineData(16, 4)]
    [InlineData(17, 0)]
    public void Predict_BedTimeToWakeUp_FormsANightOnlyWithinSixteenHours(int nightHours, int expectedGaps)
    {
        var now = At(0, 23);
        var events = Enumerable.Range(1, 5).SelectMany(day => new[] { Marker(SleepKinds.BedTime, At(-day, 6)), Marker(SleepKinds.WokeUp, At(-day, 6 + nightHours)) });

        var result = Predict(events, Context(now));

        var samples = result.Predictions.Select(prediction => prediction.SampleCount).Concat(result.InsufficientData.Select(missing => missing.SampleCount)).Single();
        Assert.Equal(expectedGaps, samples);
    }

    [Fact]
    public void Predict_BedTimeFollowedByAnotherBedTime_IgnoresTheFirst()
    {
        var now = At(0, 12);
        var events = Enumerable.Range(1, 5).SelectMany(day => new[]
        {
            Marker(SleepKinds.BedTime, At(-day, 19)),
            Marker(SleepKinds.BedTime, At(-day, 20)),
            Marker(SleepKinds.WokeUp, At(-day + 1, 6)),
        });

        var prediction = PredictSleep(events, now);

        Assert.Equal(TimeSpan.FromHours(10), prediction.ExpectedDuration!.Median);
        Assert.Equal(TimeSpan.FromHours(14), prediction.Reason.MedianGap);
    }

    [Fact]
    public void Predict_WithoutKind_KeepsLoggedSleepsAsSessions()
    {
        var events = Enumerable.Range(1, 5).Select(day => Logged(null, At(-day, 13), At(-day, 14)));

        var prediction = PredictSleep(events, At(0, 12));

        Assert.Equal(4, prediction.SampleCount);
        Assert.Equal(TimeSpan.FromHours(23), prediction.Reason.MedianGap);
    }
}
