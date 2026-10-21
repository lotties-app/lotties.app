using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Tests.EventTypes;

/// <summary>
/// <see cref="EventType.EnsureValidPayload"/> for the reserved pause keys (every type) and the sleep detail fields
/// (built-in sleep, nap and night only).
/// </summary>
public sealed class PauseAndSleepDetailRulesTests
{
    private static readonly DateTimeOffset Start = new(2026, 1, 10, 9, 0, 0, TimeSpan.FromHours(-3));
    private static readonly DateTimeOffset End = Start.AddMinutes(30);

    private static void Ensure(EventType eventType, string json, DateTimeOffset? endedAt, DateTimeOffset? startedAt = null) =>
        eventType.EnsureValidPayload(EventPayload.From(json), startedAt ?? Start, endedAt);

    private static string RejectedField(EventType eventType, string json, DateTimeOffset? endedAt, DateTimeOffset? startedAt = null) =>
        Assert.Throws<DomainValidationException>(() => Ensure(eventType, json, endedAt, startedAt)).Field;

    private static EventType CustomTimer() =>
        EventType.CreateCustom(Guid.NewGuid(), EventTypeKey.From("reading"), "Reading", "star", HexColor.From("#123456"), hasDuration: true, []);

    [Fact]
    public void RunningTimer_PausedWithOpenPause_IsAccepted()
    {
        Ensure(BuiltInEventTypes.Sleep, """{"kind":"nap","pause_count":2,"paused_seconds":130,"paused_at":"2026-01-10T12:20:00.000Z"}""", endedAt: null);
    }

    [Fact]
    public void RunningTimer_PausedLongerThanElapsedSoFar_IsAcceptedUntilItEnds()
    {
        Ensure(BuiltInEventTypes.Feeding, """{"method":"breast","pause_count":1,"paused_seconds":86400}""", endedAt: null);
    }

    [Fact]
    public void EndedTimer_WithOpenPause_IsRejected()
    {
        Assert.Equal("paused_at", RejectedField(BuiltInEventTypes.Sleep, """{"kind":"nap","paused_at":"2026-01-10T12:20:00Z"}""", End));
    }

    [Fact]
    public void EndedTimer_PausedExactlyTheElapsedTime_IsAccepted()
    {
        Ensure(BuiltInEventTypes.TummyTime, """{"pause_count":1,"paused_seconds":1800}""", End);
    }

    [Fact]
    public void EndedTimer_PausedLongerThanElapsed_IsRejected()
    {
        Assert.Equal("paused_seconds", RejectedField(BuiltInEventTypes.TummyTime, """{"paused_seconds":1801}""", End));
    }

    [Fact]
    public void EndedTimerAcrossMidnight_MultiplePausesWithinElapsed_IsAcceptedAndBeyondIsRejected()
    {
        var start = new DateTimeOffset(2026, 1, 10, 23, 50, 0, TimeSpan.FromHours(-3));
        var end = start.AddMinutes(30);

        Ensure(BuiltInEventTypes.Sleep, """{"kind":"night","pause_count":3,"paused_seconds":1800}""", end, start);
        Assert.Equal("paused_seconds", RejectedField(BuiltInEventTypes.Sleep, """{"kind":"night","pause_count":3,"paused_seconds":1801}""", end, start));
    }

    [Theory]
    [InlineData("""{"pause_count":-1}""", "pause_count")]
    [InlineData("""{"pause_count":101}""", "pause_count")]
    [InlineData("""{"pause_count":1.5}""", "pause_count")]
    [InlineData("""{"pause_count":"2"}""", "pause_count")]
    [InlineData("""{"paused_seconds":-1}""", "paused_seconds")]
    [InlineData("""{"paused_seconds":86401}""", "paused_seconds")]
    [InlineData("""{"paused_seconds":10.5}""", "paused_seconds")]
    [InlineData("""{"paused_at":"10:15"}""", "paused_at")]
    [InlineData("""{"paused_at":"2026-01-10T12:20:00"}""", "paused_at")]
    [InlineData("""{"paused_at":1736511600}""", "paused_at")]
    public void PauseKeys_OutOfRangeOrWrongShape_AreRejectedNamingTheKey(string json, string field)
    {
        Assert.Equal(field, RejectedField(BuiltInEventTypes.BreastPump, json, endedAt: null));
    }

    [Fact]
    public void PauseKeys_OnACustomTypeThatDoesNotDeclareThem_AreCheckedToo()
    {
        Assert.Equal("paused_seconds", RejectedField(CustomTimer(), """{"paused_seconds":3600}""", End));
        Ensure(CustomTimer(), """{"pause_count":1,"paused_seconds":60}""", End);
    }

    [Fact]
    public void PauseKeys_Null_HaveNoValue()
    {
        Ensure(BuiltInEventTypes.Sleep, """{"kind":"nap","pause_count":null,"paused_seconds":null,"paused_at":null}""", End);
    }

    [Theory]
    [InlineData("nap")]
    [InlineData("night")]
    public void SleepDetails_ForNapAndNight_AreAccepted(string kind)
    {
        Ensure(
            BuiltInEventTypes.Sleep,
            $$"""{"kind":"{{kind}}","how_slept":"in_bed","fall_asleep":"took_long","time_to_fall_asleep_minutes":15,"how_woke":"naturally","mood_on_wake":"good"}""",
            End);
    }

    [Theory]
    [InlineData("""{"kind":"night_waking","how_slept":"held"}""", "how_slept")]
    [InlineData("""{"kind":"bed_time","mood_on_wake":"bad"}""", "mood_on_wake")]
    [InlineData("""{"how_woke":"woken"}""", "how_woke")]
    [InlineData("""{"kind":"nap","how_slept":"hammock"}""", "how_slept")]
    [InlineData("""{"kind":"nap","time_to_fall_asleep_minutes":12.5}""", "time_to_fall_asleep_minutes")]
    [InlineData("""{"kind":"nap","time_to_fall_asleep_minutes":241}""", "time_to_fall_asleep_minutes")]
    [InlineData("""{"kind":"nap","time_to_fall_asleep_minutes":-1}""", "time_to_fall_asleep_minutes")]
    public void SleepDetails_HiddenForTheKindOrInvalid_AreRejected(string json, string field)
    {
        Assert.Equal(field, RejectedField(BuiltInEventTypes.Sleep, json, End));
    }

    [Fact]
    public void Sleep_DeprecatedFreeTextMood_IsStillAccepted()
    {
        Ensure(BuiltInEventTypes.Sleep, """{"kind":"nap","mood":"HAPPY"}""", End);
    }
}
