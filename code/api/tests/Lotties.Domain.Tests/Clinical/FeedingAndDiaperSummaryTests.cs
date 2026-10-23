using Lotties.Domain.Clinical;
using static Lotties.Domain.Tests.Clinical.ClinicalFixtures;

namespace Lotties.Domain.Tests.Clinical;

/// <summary>Golden cases of the feeding and diaper numbers: they must equal the parents' Insights (<c>feedingModel.ts</c>, <c>diaperModel.ts</c>).</summary>
public sealed class FeedingAndDiaperSummaryTests
{
    private static readonly DateTimeOffset NowJan10Noon = Brazil.Local(1, 10, 12);
    private static readonly Guid FormulaA = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static FeedObservation Feed(DateTimeOffset at, string? method, double? ml = null, string? type = null, Guid? formulaId = null, string? formulaName = null) =>
        new(at, method, ml, type, formulaId, formulaName);

    private static FeedObservation[] SampleFeeds() =>
    [
        Feed(Brazil.Local(1, 8, 8), "breast"),
        Feed(Brazil.Local(1, 8, 12), "bottle", 120, "formula", FormulaA, "Aptamil"),
        Feed(Brazil.Local(1, 8, 18), "bottle", 90, "formula", FormulaA, "Aptamil"),
        Feed(Brazil.Local(1, 9, 2), "solid"),
        Feed(Brazil.Local(1, 9, 12), "bottle", 60, "breast_milk"),
        Feed(Brazil.Local(1, 9, 15), "bottle", null, "formula", null, " Nan "),
    ];

    [Fact]
    public void Feeding_PerDayRowsCountByTheDayAFeedStartedAndSplitByMethod()
    {
        var window = Window(Brazil, (1, 8), (1, 10), NowJan10Noon);

        var summary = FeedingSummaries.Summarize(SampleFeeds(), window);

        Assert.Equal(new FeedingDaySummary(new DateOnly(2026, 1, 8), 3, 210, 1, 2, 0), summary.Days[0]);
        Assert.Equal(new FeedingDaySummary(new DateOnly(2026, 1, 9), 3, 60, 0, 2, 1), summary.Days[1]);
        Assert.Equal(new FeedingDaySummary(new DateOnly(2026, 1, 10), 0, 0, 0, 0, 0), summary.Days[2]);
        Assert.Equal((1, 4, 1), (summary.BreastCount, summary.BottleCount, summary.SolidCount));
    }

    [Fact]
    public void Feeding_AveragesAreOverCompletedDaysWithDataAndBottleMlOnlyOverDaysWithBottleMl()
    {
        var window = Window(Brazil, (1, 8), (1, 10), NowJan10Noon);

        var summary = FeedingSummaries.Summarize(SampleFeeds(), window);

        Assert.Equal(3d, summary.FeedsPerDay);
        Assert.Equal((210d + 60d) / 2, summary.BottleMlPerDay);
    }

    [Fact]
    public void Feeding_IntervalIsTheMeanOfTheGapsUpToEightHours_LongerGapsAreDropped()
    {
        var window = Window(Brazil, (1, 8), (1, 10), NowJan10Noon);

        var summary = FeedingSummaries.Summarize(SampleFeeds(), window);

        // Gaps: 4 h, 6 h, 8 h (kept: not longer than 8 h), 10 h (dropped), 3 h.
        Assert.Equal(TimeSpan.FromHours((4 + 6 + 8 + 3) / 4d).TotalMilliseconds, summary.AverageIntervalMs);
    }

    [Fact]
    public void Feeding_FeedsAtTheSameInstant_HaveNoGap()
    {
        var window = Window(Brazil, (1, 9), (1, 9), NowJan10Noon);
        var feeds = new[] { Feed(Brazil.Local(1, 9, 8), "bottle", 100), Feed(Brazil.Local(1, 9, 8), "bottle", 100) };

        var summary = FeedingSummaries.Summarize(feeds, window);

        Assert.Null(summary.AverageIntervalMs);
        Assert.Equal(2, summary.Days[0].Feeds);
    }

    [Fact]
    public void Feeding_FormulasAreGroupedByIdElseByNameForBottlesOfFormula()
    {
        var window = Window(Brazil, (1, 8), (1, 10), NowJan10Noon);
        var feeds = SampleFeeds().Append(Feed(Brazil.Local(1, 9, 20), "bottle", 30, "formula", null, "nan")).ToArray();

        var summary = FeedingSummaries.Summarize(feeds, window);

        Assert.Equal(
            [new FormulaUsage(FormulaA, "Aptamil", 2, 210), new FormulaUsage(null, "nan", 2, 30)],
            summary.Formulas.ToArray());
    }

    [Fact]
    public void Feeding_BottleWithAFormulaIdButNoType_IsStillAFormulaBottle_BreastMilkAndBreastAreNot()
    {
        var window = Window(Brazil, (1, 9), (1, 9), NowJan10Noon);
        var feeds = new[]
        {
            Feed(Brazil.Local(1, 9, 8), "bottle", 100, null, FormulaA, null),
            Feed(Brazil.Local(1, 9, 11), "bottle", 100, "breast_milk"),
            Feed(Brazil.Local(1, 9, 14), "breast", null, null, FormulaA, "Aptamil"),
        };

        var summary = FeedingSummaries.Summarize(feeds, window);

        var only = Assert.Single(summary.Formulas);
        Assert.Equal((FormulaA, string.Empty, 1, 100d), (only.FormulaId, only.Name, only.Feeds, only.Ml));
    }

    [Fact]
    public void Feeding_FeedsOutsideTheRangeOrAfterNow_AreIgnored()
    {
        var window = Window(Brazil, (1, 9), (1, 10), NowJan10Noon);
        var feeds = new[]
        {
            Feed(Brazil.Local(1, 8, 23, 59), "breast"),
            Feed(Brazil.Local(1, 10, 11), "breast"),
            Feed(Brazil.Local(1, 10, 13), "breast"),
        };

        var summary = FeedingSummaries.Summarize(feeds, window);

        Assert.Equal((0, 1), (summary.Days[0].Feeds, summary.Days[1].Feeds));
        Assert.Equal(1, summary.BreastCount);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0d)]
    [InlineData(-5d)]
    public void Feeding_BottleWithoutAPositiveAmount_AddsNoMl(double? ml)
    {
        var window = Window(Brazil, (1, 9), (1, 9), NowJan10Noon);

        var summary = FeedingSummaries.Summarize([Feed(Brazil.Local(1, 9, 8), "bottle", ml)], window);

        Assert.Equal((1, 0d), (summary.Days[0].Feeds, summary.Days[0].BottleMl));
        Assert.Null(summary.BottleMlPerDay);
    }

    [Fact]
    public void Feeding_Nothing_HasZeroRowsAndNoAverages()
    {
        var window = Window(Brazil, (1, 9), (1, 10), NowJan10Noon);

        var summary = FeedingSummaries.Summarize([], window);

        Assert.Equal(2, summary.Days.Count);
        Assert.Equal((null, null, null), (summary.FeedsPerDay, summary.AverageIntervalMs, summary.BottleMlPerDay));
        Assert.Empty(summary.Formulas);
    }

    [Fact]
    public void Feeding_AcrossASpringForwardDay_BucketsByLocalMidnight()
    {
        var window = Window(NewYork, (3, 7), (3, 9), NewYork.Local(3, 12, 12));
        var feeds = new[]
        {
            Feed(NewYork.Local(3, 7, 23, 30), "breast"),
            Feed(NewYork.Local(3, 8, 0, 30), "breast"),
            Feed(NewYork.Local(3, 8, 23, 30), "breast"),
            Feed(NewYork.Local(3, 9, 0, 30), "breast"),
        };

        var summary = FeedingSummaries.Summarize(feeds, window);

        Assert.Equal([1, 2, 1], summary.Days.Select(day => day.Feeds).ToArray());
    }

    [Fact]
    public void Diapers_PerDayRowsCountWetAndDirtyWithMixedInBoth()
    {
        var window = Window(Brazil, (1, 8), (1, 10), NowJan10Noon);
        var changes = new[]
        {
            new DiaperObservation(Brazil.Local(1, 9, 7), "WET"),
            new DiaperObservation(Brazil.Local(1, 9, 9), "DIRTY"),
            new DiaperObservation(Brazil.Local(1, 9, 11), "MIXED"),
            new DiaperObservation(Brazil.Local(1, 9, 13), "mixed"),
            new DiaperObservation(Brazil.Local(1, 9, 15), null),
            new DiaperObservation(Brazil.Local(1, 8, 7), "wet"),
            new DiaperObservation(Brazil.Local(1, 10, 8), "WET"),
            new DiaperObservation(Brazil.Local(1, 10, 9), "WET"),
        };

        var summary = DiaperSummaries.Summarize(changes, window);

        Assert.Equal(new DiaperDaySummary(new DateOnly(2026, 1, 8), 1, 1, 0), summary.Days[0]);
        Assert.Equal(new DiaperDaySummary(new DateOnly(2026, 1, 9), 5, 3, 3), summary.Days[1]);
        Assert.Equal(new DiaperDaySummary(new DateOnly(2026, 1, 10), 2, 2, 0), summary.Days[2]);
    }

    [Fact]
    public void Diapers_AveragesLeaveTodayOutWhenAnotherDayHasData()
    {
        var window = Window(Brazil, (1, 8), (1, 10), NowJan10Noon);
        var changes = new[]
        {
            new DiaperObservation(Brazil.Local(1, 9, 7), "MIXED"),
            new DiaperObservation(Brazil.Local(1, 9, 9), "DIRTY"),
            new DiaperObservation(Brazil.Local(1, 8, 7), "WET"),
            new DiaperObservation(Brazil.Local(1, 10, 8), "WET"),
        };

        var summary = DiaperSummaries.Summarize(changes, window);

        Assert.Equal((1.5d, 1d, 1d), (summary.PerDay, summary.WetPerDay, summary.DirtyPerDay));
    }

    [Fact]
    public void Diapers_TodayAlone_IsCounted_AndChangesAfterNowAreIgnored()
    {
        var window = Window(Brazil, (1, 9), (1, 10), NowJan10Noon);
        var changes = new[]
        {
            new DiaperObservation(Brazil.Local(1, 10, 8), "WET"),
            new DiaperObservation(Brazil.Local(1, 10, 13), "DIRTY"),
        };

        var summary = DiaperSummaries.Summarize(changes, window);

        Assert.Equal((1d, 1d, 0d), (summary.PerDay, summary.WetPerDay, summary.DirtyPerDay));
    }

    [Fact]
    public void Diapers_Nothing_HasNoAverages()
    {
        var summary = DiaperSummaries.Summarize([], Window(Brazil, (1, 9), (1, 10), NowJan10Noon));

        Assert.Equal((null, null, null), (summary.PerDay, summary.WetPerDay, summary.DirtyPerDay));
        Assert.Equal(2, summary.Days.Count);
    }
}
