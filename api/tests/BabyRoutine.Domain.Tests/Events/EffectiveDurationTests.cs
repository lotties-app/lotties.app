using BabyRoutine.Domain.Events;

namespace BabyRoutine.Domain.Tests.Events;

/// <summary><see cref="EffectiveDuration"/> and <see cref="EventPayloadFacts"/>: pauses are excluded from durations.</summary>
public sealed class EffectiveDurationTests
{
    private static readonly TimeSpan Brasilia = TimeSpan.FromHours(-3);
    private static readonly DateTimeOffset Start = new(2026, 1, 10, 9, 0, 0, Brasilia);

    [Fact]
    public void Of_PayloadWithoutPauseKeys_IsThePlainDuration()
    {
        var duration = EffectiveDuration.Of(Start, Start.AddMinutes(75), EventPayload.From("""{"kind":"nap"}"""));

        Assert.Equal(TimeSpan.FromMinutes(75), duration);
    }

    [Fact]
    public void Of_MultiplePauses_SubtractsTheirTotal()
    {
        var payload = EventPayload.From("""{"kind":"nap","pause_count":3,"paused_seconds":900}""");

        var duration = EffectiveDuration.Of(Start, Start.AddMinutes(75), payload);

        Assert.Equal(TimeSpan.FromMinutes(60), duration);
    }

    [Fact]
    public void Of_SleepAcrossMidnight_SubtractsPausesFromTheRealElapsedTime()
    {
        var start = new DateTimeOffset(2026, 1, 10, 23, 30, 0, Brasilia);
        var end = new DateTimeOffset(2026, 1, 11, 1, 15, 0, Brasilia);

        var duration = EffectiveDuration.Of(start, end, EventPayload.From("""{"pause_count":2,"paused_seconds":600}"""));

        Assert.Equal(TimeSpan.FromMinutes(95), duration);
    }

    [Fact]
    public void Of_PausesLongerThanTheEvent_IsZero()
    {
        Assert.Equal(TimeSpan.Zero, EffectiveDuration.Of(Start, Start.AddMinutes(5), TimeSpan.FromMinutes(10)));
    }

    [Fact]
    public void Of_RunningEvent_IsNull()
    {
        Assert.Null(EffectiveDuration.Of(Start, null, EventPayload.From("""{"paused_seconds":60}""")));
    }

    [Fact]
    public void Read_PauseKeys_ReturnsCountSecondsAndOpenPauseInUtc()
    {
        var facts = EventPayloadFacts.Read(EventPayload.From("""{"kind":"nap","pause_count":2,"paused_seconds":130,"paused_at":"2026-01-10T09:40:00-03:00"}"""));

        Assert.Equal(("nap", 2, 130, TimeSpan.FromSeconds(130)), (facts.Kind, facts.PauseCount, facts.PausedSeconds, facts.Paused));
        Assert.Equal(new DateTimeOffset(2026, 1, 10, 12, 40, 0, TimeSpan.Zero), facts.PausedAt);
        Assert.Equal(TimeSpan.Zero, facts.PausedAt!.Value.Offset);
    }

    [Theory]
    [InlineData("""{"pause_count":"2","paused_seconds":-5}""")]
    [InlineData("""{"pause_count":1.5,"paused_seconds":90000}""")]
    [InlineData("""{"pause_count":null,"paused_seconds":null,"paused_at":"yesterday"}""")]
    [InlineData("""{"paused_seconds":12.25,"paused_at":42}""")]
    public void Read_StoredValuesBreakingTheRules_ReadAsNoPauses(string json)
    {
        var facts = EventPayloadFacts.Read(EventPayload.From(json));

        Assert.Equal((0, 0, (DateTimeOffset?)null), (facts.PauseCount, facts.PausedSeconds, facts.PausedAt));
    }

    [Fact]
    public void Read_EmptyPayload_IsNone()
    {
        Assert.Equal(EventPayloadFacts.None, EventPayloadFacts.Read(EventPayload.Empty));
    }
}
