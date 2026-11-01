using Lotties.Domain.EventTypes;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Tests.Patterns;

public sealed class BellyPainPatternsTests
{
    private static readonly EventTypeKey Pain = BuiltInEventTypes.BellyPain.Key;
    private static readonly EventTypeKey Massage = BuiltInEventTypes.BellyMassage.Key;
    private static readonly TimeZoneInfo NewYork = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    /// <summary>An instant at the New York wall-clock time on 2026-03-<paramref name="day"/> (daylight saving starts on the 8th).</summary>
    private static DateTimeOffset NewYorkAt(int day, int hour, int minute = 0)
    {
        var local = new DateTime(2026, 3, day, hour, minute, 0, DateTimeKind.Unspecified);
        return new DateTimeOffset(local, NewYork.GetUtcOffset(local));
    }

    private static ObservedEvent Event(EventTypeKey key, DateTimeOffset at) => new(key, at, at);

    [Fact]
    public void Detect_AcrossTheDaylightSavingChange_KeepsTheLocalTimeWithTheZone()
    {
        var events = Enumerable.Range(4, 8).Select(day => Event(Pain, NewYorkAt(day, 18))).ToArray();
        var now = NewYorkAt(11, 20);

        var inZone = BellyPainPatterns.Detect(events, now, LocalClock.InZone(NewYork));
        var fixedOffset = BellyPainPatterns.Detect(events, now, LocalClock.WithOffset(NewYork.GetUtcOffset(now)));

        var pattern = Assert.IsType<TimeOfDayPattern>(inZone);
        Assert.Equal(new TimeOnly(18, 0), pattern.Typical);
        Assert.Equal(TimeSpan.Zero, pattern.Spread);
        Assert.Equal(8, pattern.Days.Count);
        Assert.NotEqual(new TimeOnly(18, 0), fixedOffset?.Typical);
    }

    [Fact]
    public void Detect_OnlyBellyPainEventsUpToNowCount()
    {
        var now = NewYorkAt(20, 12);
        var events = new[] { 14, 15, 16 }.Select(day => Event(Pain, NewYorkAt(day, 18)))
            .Concat(new[] { 17, 18 }.Select(day => Event(Massage, NewYorkAt(day, 18))))
            .Append(Event(Pain, NewYorkAt(20, 18)))
            .ToArray();

        Assert.Null(BellyPainPatterns.Detect(events, now, LocalClock.InZone(NewYork)));
    }

    [Fact]
    public void LastLoggedAt_TakesTheLatestPainOrMassageStartedUpToNow()
    {
        var now = NewYorkAt(20, 18);
        var events = new[]
        {
            Event(Pain, NewYorkAt(20, 9)),
            Event(Massage, NewYorkAt(20, 17, 30)),
            Event(BuiltInEventTypes.Feeding.Key, NewYorkAt(20, 17, 50)),
            Event(Pain, NewYorkAt(20, 19)),
        };

        Assert.Equal(NewYorkAt(20, 17, 30), BellyPainPatterns.LastLoggedAt(events, now));
        Assert.Null(BellyPainPatterns.LastLoggedAt([], now));
    }

    [Theory]
    [InlineData(-46, false)]
    [InlineData(-45, true)]
    [InlineData(10, true)]
    public void IsHandled_LoggedFromFortyFiveMinutesBeforeTheWindow(int minutesFromStart, bool handled)
    {
        var start = NewYorkAt(20, 17, 30);

        Assert.Equal(handled, BellyPainPatterns.IsHandled(start, start.AddMinutes(minutesFromStart)));
        Assert.False(BellyPainPatterns.IsHandled(start, null));
    }
}
