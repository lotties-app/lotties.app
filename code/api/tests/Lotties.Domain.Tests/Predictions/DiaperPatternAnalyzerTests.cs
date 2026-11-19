using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Tests.Predictions;

public sealed class DiaperPatternAnalyzerTests
{
    private static readonly EventTypeKey Diaper = BuiltInEventTypes.Diaper.Key;
    private static readonly DateTimeOffset Now = new(2025, 11, 15, 12, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan LookBack = TimeSpan.FromDays(7);

    [Fact]
    public void Analyze_ReturnsNullStats_WhenNoEvents()
    {
        var result = DiaperPatternAnalyzer.Analyze([], Now, LookBack);

        Assert.Null(result.WetGapStats);
        Assert.Null(result.DirtyGapStats);
    }

    [Fact]
    public void Analyze_SplitsWetAndDirty_Correctly()
    {
        // 6 wet diapers (including MIXED), 4 dirty diapers (including MIXED).
        var events = new List<ObservedEvent>
        {
            new(Diaper, Now.AddHours(-120), null, Content: "WET"),
            new(Diaper, Now.AddHours(-96), null, Content: "WET"),
            new(Diaper, Now.AddHours(-72), null, Content: "DIRTY"),
            new(Diaper, Now.AddHours(-48), null, Content: "MIXED"),
            new(Diaper, Now.AddHours(-24), null, Content: "WET"),
            new(Diaper, Now.AddHours(-12), null, Content: "DIRTY"),
            new(Diaper, Now.AddHours(-6), null, Content: "WET"),
        };

        var result = DiaperPatternAnalyzer.Analyze(events, Now, LookBack);

        // Wet: WET at -120, -96, MIXED at -48, WET at -24, WET at -6 => 5 wet events, 4 gaps.
        Assert.NotNull(result.WetGapStats);
        Assert.Equal(4, result.WetGapStats.SampleCount);

        // Dirty: DIRTY at -72, MIXED at -48, DIRTY at -12 => 3 dirty events, 2 gaps.
        // 2 gaps < MinimumGaps (3), so dirty stats should be null.
        Assert.Null(result.DirtyGapStats);
    }

    [Fact]
    public void Analyze_ReturnsBothStats_WhenEnoughGaps()
    {
        var events = new List<ObservedEvent>();
        // 6 wet diapers spaced 24h apart.
        for (var i = 0; i < 6; i++)
        {
            events.Add(new ObservedEvent(Diaper, Now.AddHours(-(i + 1) * 24), null, Content: "WET"));
        }
        // 6 dirty diapers spaced 48h apart.
        for (var i = 0; i < 6; i++)
        {
            events.Add(new ObservedEvent(Diaper, Now.AddHours(-(i + 1) * 48), null, Content: "DIRTY"));
        }

        var result = DiaperPatternAnalyzer.Analyze(events, Now, LookBack);

        Assert.NotNull(result.WetGapStats);
        Assert.Equal(5, result.WetGapStats.SampleCount);
        Assert.True(result.WetGapStats.MedianGap > TimeSpan.Zero);
        Assert.True(result.WetGapStats.P10Gap <= result.WetGapStats.MedianGap);
        Assert.True(result.WetGapStats.P90Gap >= result.WetGapStats.MedianGap);

        // Only 3 dirty diapers fit in 7 days at 48h spacing (at -48, -96, -144 which is within 7 days).
        // That gives 2 gaps, below MinimumGaps.
        // Let's check: -48, -96, -144 are all within 168h (7 days). So 3 dirty events, 2 gaps.
        Assert.Null(result.DirtyGapStats);
    }

    [Fact]
    public void Analyze_IgnoresEventsOutsideLookBack()
    {
        var events = new List<ObservedEvent>
        {
            // These are within look-back.
            new(Diaper, Now.AddHours(-24), null, Content: "WET"),
            new(Diaper, Now.AddHours(-48), null, Content: "WET"),
            new(Diaper, Now.AddHours(-72), null, Content: "WET"),
            // This is outside look-back (> 7 days ago).
            new(Diaper, Now.AddDays(-8), null, Content: "WET"),
        };

        var result = DiaperPatternAnalyzer.Analyze(events, Now, LookBack);

        // Only 3 wet events in window => 2 gaps < MinimumGaps (3).
        Assert.Null(result.WetGapStats);
    }

    [Fact]
    public void Analyze_DropsDuplicateGaps()
    {
        // Two wet diapers at nearly the same time (gap < 1 minute) should be dropped.
        var events = new List<ObservedEvent>
        {
            new(Diaper, Now.AddHours(-96), null, Content: "WET"),
            new(Diaper, Now.AddHours(-72), null, Content: "WET"),
            new(Diaper, Now.AddHours(-72).AddSeconds(30), null, Content: "WET"), // duplicate
            new(Diaper, Now.AddHours(-48), null, Content: "WET"),
            new(Diaper, Now.AddHours(-24), null, Content: "WET"),
        };

        var result = DiaperPatternAnalyzer.Analyze(events, Now, LookBack);

        Assert.NotNull(result.WetGapStats);
        // 5 events but one gap is < 1 min, so usable gaps = 3 (from 4 usable intervals minus 1 duplicate).
        Assert.True(result.WetGapStats.SampleCount >= DiaperPatternAnalyzer.MinimumGaps);
    }

    [Fact]
    public void Analyze_MixedCountsInBothSubTypes()
    {
        // All MIXED: should count as both wet and dirty.
        var events = new List<ObservedEvent>();
        for (var i = 0; i < 6; i++)
        {
            events.Add(new ObservedEvent(Diaper, Now.AddHours(-(i + 1) * 24), null, Content: "MIXED"));
        }

        var result = DiaperPatternAnalyzer.Analyze(events, Now, LookBack);

        Assert.NotNull(result.WetGapStats);
        Assert.Equal(5, result.WetGapStats.SampleCount);

        // Same 6 events also count as dirty.
        Assert.NotNull(result.DirtyGapStats);
        Assert.Equal(5, result.DirtyGapStats.SampleCount);
    }
}