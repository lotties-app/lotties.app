using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Tests.Events;

/// <summary><see cref="Event.NeedsPayloadCheck"/>: an unchanged legacy payload never blocks an edit.</summary>
public sealed class EventPayloadCheckTests
{
    private static readonly DateTimeOffset Start = new(2026, 1, 10, 8, 0, 0, TimeSpan.Zero);
    private static readonly EventPayload Legacy = EventPayload.From("""{"method":"bottle","side":"left"}""");

    private static Event Stored(DateTimeOffset? endedAt) =>
        Event.Create(Guid.NewGuid(), Guid.NewGuid(), BuiltInEventTypes.FeedingId, Guid.NewGuid(), Start, endedAt, Legacy, null, TestClock.Now);

    [Fact]
    public void NeedsPayloadCheck_SameTypeAndEquivalentPayload_IsFalse()
    {
        var stored = Stored(Start.AddMinutes(10));

        Assert.False(stored.NeedsPayloadCheck(BuiltInEventTypes.FeedingId, EventPayload.From("""{ "side": "left", "method": "bottle" }"""), Start.AddMinutes(20)));
    }

    [Fact]
    public void NeedsPayloadCheck_ChangedPayload_IsTrue()
    {
        Assert.True(Stored(Start.AddMinutes(10)).NeedsPayloadCheck(BuiltInEventTypes.FeedingId, EventPayload.From("""{"method":"bottle"}"""), Start.AddMinutes(10)));
    }

    [Fact]
    public void NeedsPayloadCheck_ChangedType_IsTrue()
    {
        Assert.True(Stored(Start.AddMinutes(10)).NeedsPayloadCheck(BuiltInEventTypes.SleepId, Legacy, Start.AddMinutes(10)));
    }

    [Fact]
    public void NeedsPayloadCheck_RunningEventBeingCompleted_IsTrue()
    {
        Assert.True(Stored(endedAt: null).NeedsPayloadCheck(BuiltInEventTypes.FeedingId, Legacy, Start.AddMinutes(10)));
    }

    [Fact]
    public void NeedsPayloadCheck_RunningEventStillRunning_IsFalse()
    {
        Assert.False(Stored(endedAt: null).NeedsPayloadCheck(BuiltInEventTypes.FeedingId, Legacy, endedAt: null));
    }
}
