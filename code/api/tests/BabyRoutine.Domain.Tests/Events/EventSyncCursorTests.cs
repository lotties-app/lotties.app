using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Tests.Events;

public sealed class EventSyncCursorTests
{
    [Fact]
    public void After_Event_RoundTripsThroughValue()
    {
        var stored = Event.Create(Guid.NewGuid(), Guid.NewGuid(), BuiltInEventTypes.SleepId, Guid.NewGuid(), TestClock.Now, null, EventPayload.Empty, null, TestClock.Now.AddTicks(1230));

        var parsed = EventSyncCursor.From(EventSyncCursor.After(stored).Value);

        Assert.Equal((stored.UpdatedAt, stored.Id), (parsed.UpdatedAt, parsed.EventId));
    }

    [Fact]
    public void After_Event_ValueIsUrlSafe()
    {
        var stored = Event.Create(Guid.NewGuid(), Guid.NewGuid(), BuiltInEventTypes.SleepId, Guid.NewGuid(), TestClock.Now, null, EventPayload.Empty, null, TestClock.Now);

        var value = EventSyncCursor.After(stored).Value;

        Assert.Equal(value, Uri.EscapeDataString(value));
    }

    [Fact]
    public void AtOrAfter_Since_NormalizesToUtcWithEmptyId()
    {
        var since = new DateTimeOffset(2026, 1, 10, 9, 0, 0, TimeSpan.FromHours(-3)).AddTicks(7);

        var cursor = EventSyncCursor.AtOrAfter(since);

        Assert.Equal((TestClock.Now, Guid.Empty, TimeSpan.Zero), (cursor.UpdatedAt, cursor.EventId, cursor.UpdatedAt.Offset));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("123")]
    [InlineData("-1.0123456789abcdef0123456789abcdef")]
    [InlineData("1.not-a-guid")]
    [InlineData("1.2.3")]
    [InlineData("99999999999999999999.0123456789abcdef0123456789abcdef")]
    public void From_Invalid_ThrowsValidation(string? value)
    {
        Assert.Throws<DomainValidationException>(() => EventSyncCursor.From(value));
    }
}
