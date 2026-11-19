using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Api.Tests.Domain.Predictions;

public sealed class FeedingPatternAnalyzerTests
{
    private static readonly EventTypeKey FeedingKey = EventTypeKey.From("feeding");
    private static readonly EventTypeKey SleepKey = EventTypeKey.From("sleep");
    private static readonly DateTimeOffset Base = new(2025, 6, 15, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public void IsTopUpFeed_ReturnsTrue_WhenGapBelowThreshold()
    {
        var previous = new ObservedEvent(FeedingKey, Base, Base.AddMinutes(20));
        var current = new ObservedEvent(FeedingKey, Base.AddMinutes(30), Base.AddMinutes(45));

        Assert.True(FeedingPatternAnalyzer.IsTopUpFeed(current, previous, TimeSpan.FromMinutes(15)));
    }

    [Fact]
    public void IsTopUpFeed_ReturnsFalse_WhenGapAtOrAboveThreshold()
    {
        var previous = new ObservedEvent(FeedingKey, Base, Base.AddMinutes(20));
        var current = new ObservedEvent(FeedingKey, Base.AddMinutes(35), Base.AddMinutes(50));

        // Gap is exactly 15 minutes; threshold is exclusive (<), so this should be false.
        Assert.False(FeedingPatternAnalyzer.IsTopUpFeed(current, previous, TimeSpan.FromMinutes(15)));
    }

    [Fact]
    public void IsTopUpFeed_ReturnsFalse_WhenPreviousIsNull()
    {
        var current = new ObservedEvent(FeedingKey, Base, Base.AddMinutes(15));

        Assert.False(FeedingPatternAnalyzer.IsTopUpFeed(current, null, TimeSpan.FromMinutes(15)));
    }

    [Fact]
    public void IsTopUpFeed_ReturnsFalse_WhenTypesDiffer()
    {
        var previous = new ObservedEvent(SleepKey, Base, Base.AddMinutes(20));
        var current = new ObservedEvent(FeedingKey, Base.AddMinutes(25), Base.AddMinutes(40));

        Assert.False(FeedingPatternAnalyzer.IsTopUpFeed(current, previous, TimeSpan.FromMinutes(15)));
    }

    [Fact]
    public void IsTopUpFeed_UsesDefaultThreshold_WhenNotSpecified()
    {
        var previous = new ObservedEvent(FeedingKey, Base, Base.AddMinutes(10));
        var current = new ObservedEvent(FeedingKey, Base.AddMinutes(12), Base.AddMinutes(25));

        // 2-minute gap is well under the default 15-minute threshold.
        Assert.True(FeedingPatternAnalyzer.IsTopUpFeed(current, previous));
    }

    [Fact]
    public void IsTopUpFeed_UsesEndedAtOfPrevious_WhenAvailable()
    {
        // Previous ended at +20, current starts at +22: gap is 2 minutes.
        var previous = new ObservedEvent(FeedingKey, Base, Base.AddMinutes(20));
        var current = new ObservedEvent(FeedingKey, Base.AddMinutes(22), Base.AddMinutes(35));

        Assert.True(FeedingPatternAnalyzer.IsTopUpFeed(current, previous, TimeSpan.FromMinutes(15)));
    }

    [Fact]
    public void IsTopUpFeed_FallsBackToStartedAt_WhenPreviousStillRunning()
    {
        // Previous has no EndedAt (still running); gap measured from its StartedAt.
        var previous = new ObservedEvent(FeedingKey, Base, null);
        var current = new ObservedEvent(FeedingKey, Base.AddMinutes(5), Base.AddMinutes(20));

        Assert.True(FeedingPatternAnalyzer.IsTopUpFeed(current, previous, TimeSpan.FromMinutes(15)));
    }

    [Fact]
    public void IsRetrospectiveEntry_ReturnsTrue_WhenLagExceedsThreshold()
    {
        var startedAt = Base;
        var createdAt = Base.AddHours(3);

        Assert.True(FeedingPatternAnalyzer.IsRetrospectiveEntry(createdAt, startedAt));
    }

    [Fact]
    public void IsRetrospectiveEntry_ReturnsFalse_WhenLagWithinThreshold()
    {
        var startedAt = Base;
        var createdAt = Base.AddHours(1);

        Assert.False(FeedingPatternAnalyzer.IsRetrospectiveEntry(createdAt, startedAt));
    }

    [Fact]
    public void IsRetrospectiveEntry_ReturnsFalse_WhenCreatedAtBeforeStartedAt()
    {
        // Edge case: clock skew or server-side creation before the event's own start.
        var startedAt = Base;
        var createdAt = Base.AddHours(-1);

        Assert.False(FeedingPatternAnalyzer.IsRetrospectiveEntry(createdAt, startedAt));
    }

    [Fact]
    public void IsRetrospectiveEntry_RespectsCustomThreshold()
    {
        var startedAt = Base;
        var createdAt = Base.AddMinutes(45);

        Assert.True(FeedingPatternAnalyzer.IsRetrospectiveEntry(createdAt, startedAt, TimeSpan.FromMinutes(30)));
        Assert.False(FeedingPatternAnalyzer.IsRetrospectiveEntry(createdAt, startedAt, TimeSpan.FromHours(1)));
    }
}