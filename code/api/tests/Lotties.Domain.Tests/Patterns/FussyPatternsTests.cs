using Lotties.Domain.EventTypes;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Tests.Patterns;

public sealed class FussyPatternsTests
{
    private static readonly EventTypeKey Fussy = BuiltInEventTypes.Fussy.Key;
    private static readonly TimeSpan SaoPaulo = TimeSpan.FromHours(-3);
    private static readonly LocalClock Clock = LocalClock.WithOffset(SaoPaulo);

    /// <summary>A São Paulo wall-clock time on 2026-10-<paramref name="day"/>.</summary>
    private static DateTimeOffset At(int day, int hour, int minute = 0) => new(2026, 10, day, hour, minute, 0, SaoPaulo);

    private static ObservedEvent Spell(EventTypeKey key, DateTimeOffset start) => new(key, start, start.AddMinutes(40));

    [Fact]
    public void Detect_FussySpellsAroundSixInTheEvening_ReusesTheRecurringDetector()
    {
        var events = new[] { 14, 15, 16, 17, 18, 19 }.Select((day, index) => Spell(Fussy, At(day, 18, index % 2 == 0 ? 0 : 10))).ToArray();
        var now = At(20, 12);

        var pattern = Assert.IsType<TimeOfDayPattern>(FussyPatterns.Detect(events, now, Clock));
        var direct = RecurringTimeOfDayPattern.Detect(events.Select(item => Clock.ToLocal(item.StartedAt)), Clock.DateOf(now));

        Assert.Equal(new TimeOnly(18, 5), pattern.Typical);
        Assert.Equal((new TimeOnly(17, 35), new TimeOnly(18, 35)), (pattern.WindowStart, pattern.WindowEnd));
        Assert.Equal(6, pattern.Days.Count);
        Assert.Equal(direct!.Typical, pattern.Typical);
        Assert.Equal(direct.Days.Count, pattern.Days.Count);
    }

    [Fact]
    public void Detect_OnlyFussyEventsUpToNowCount()
    {
        var now = At(20, 12);
        var events = new[] { 14, 15, 16 }.Select(day => Spell(Fussy, At(day, 18)))
            .Concat(new[] { 17, 18 }.Select(day => Spell(BuiltInEventTypes.BellyPain.Key, At(day, 18))))
            .Append(Spell(Fussy, At(20, 18)))
            .ToArray();

        Assert.Null(FussyPatterns.Detect(events, now, Clock));
    }

    [Fact]
    public void LastLoggedAt_TakesTheLatestFussySpellStartedUpToNow()
    {
        var now = At(20, 18);
        var events = new[]
        {
            Spell(Fussy, At(20, 9)),
            Spell(Fussy, At(20, 17, 30)),
            Spell(BuiltInEventTypes.BellyMassage.Key, At(20, 17, 50)),
            Spell(Fussy, At(20, 19)),
        };

        Assert.Equal(At(20, 17, 30), FussyPatterns.LastLoggedAt(events, now));
        Assert.Null(FussyPatterns.LastLoggedAt([], now));
    }

    [Theory]
    [InlineData(-46, false)]
    [InlineData(-45, true)]
    [InlineData(10, true)]
    public void IsHandled_LoggedFromFortyFiveMinutesBeforeTheWindow(int minutesFromStart, bool handled)
    {
        var start = At(20, 17, 30);

        Assert.Equal(handled, FussyPatterns.IsHandled(start, start.AddMinutes(minutesFromStart)));
        Assert.False(FussyPatterns.IsHandled(start, null));
    }
}
