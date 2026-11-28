using Lotties.Domain.CommunityInsights;
using static Lotties.Domain.Tests.CommunityInsights.CommunityFixtures;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// What one baby is served of a release (<see cref="CommunityServing"/>, docs/design/34-community-insights.md section 6 "Serving"):
/// every v1 statistic, her fine cell or the coarse fallback, the serving thresholds, only v1 values, the periods and the data window.
/// </summary>
public sealed class CommunityServingTests
{
    private const string Bottle = "bottle_ml_per_feed";

    private static CommunityStatisticsCatalog Shipped => CommunityFixtures.Catalog;

    private static readonly DateTimeOffset Generated = new(2026, 10, 2, 3, 0, 0, TimeSpan.Zero);

    private static CommunityReleaseCell Cell(string statistic, int from, int to, CommunityGroupSize babies, params (string Name, decimal Value)[] values) =>
        new(statistic, new CommunityBand(from, to), null, values.ToDictionary(value => value.Name, value => value.Value, StringComparer.Ordinal), babies);

    private static CommunityRelease Release(params CommunityReleaseCell[] cells) => new(
        Generated,
        Shipped.Version,
        IsPlaceholder: false,
        [.. Shipped.InV1.Select(statistic => new CommunityReleaseStatistic(statistic.Key, statistic.K, statistic.Epsilon!.Value))],
        cells);

    private static CommunityServedStatistic Of(CommunityServedView view, string key) => view.Statistics.Single(statistic => statistic.Key == key);

    [Fact]
    public void View_ListsEveryV1StatisticInCatalogOrder_WithItsPeriod()
    {
        var view = CommunityServing.ViewFor(Release(), Shipped, ageWeeks: 10)!;

        Assert.Equal(Shipped.InV1.Select(statistic => statistic.Key), view.Statistics.Select(statistic => statistic.Key));
        Assert.Equal(
            ["bottle_ml_per_feed", "tummy_minutes_per_day", "naps_per_day", "day_sleep_minutes", "night_sleep_minutes", "cry_outcome_by_cause"],
            view.Statistics.Select(statistic => statistic.Key));
        Assert.All(view.Statistics, statistic => Assert.Null(statistic.Cell));
        Assert.Equal(CommunityStatisticPeriod.PreviousQuarter, Of(view, Bottle).Period);
        Assert.Equal(CommunityStatisticPeriod.SinceConsent, Of(view, Tummy).Period);
        Assert.Equal(CommunityStatisticPeriod.SinceConsent, Of(view, Cry).Period);
    }

    [Fact]
    public void View_DataPeriodIsThePreviousQuarterOfTheRelease_AsTheAggregatorReadsIt()
    {
        var view = CommunityServing.ViewFor(Release(), Shipped, ageWeeks: 10)!;

        Assert.Equal(CommunityDataWindow.PreviousQuarterOf(Generated), view.PreviousQuarter);
        Assert.Equal((new DateOnly(2026, 7, 1), new DateOnly(2026, 9, 30)), (view.PreviousQuarter.From, view.PreviousQuarter.To));
        Assert.Equal(Generated, view.GeneratedAt);
    }

    [Fact]
    public void View_FineCellWhenPublished_ElseTheCoarseFallback()
    {
        var release = Release(
            Cell(Tummy, 9, 10, CommunityGroupSize.Babies20To49, ("share_of_days_with_any", 0.5m)),
            Cell(Tummy, 8, 12, CommunityGroupSize.Babies50To99, ("share_of_days_with_any", 0.6m)));

        var fine = Of(CommunityServing.ViewFor(release, Shipped, ageWeeks: 9)!, Tummy).Cell!;
        var coarse = Of(CommunityServing.ViewFor(release, Shipped, ageWeeks: 10)!, Tummy).Cell!;

        Assert.Equal((new CommunityBand(9, 10), CommunityGroupSize.Babies20To49, 0.5m), (fine.Band, fine.GroupSize, fine.Values["share_of_days_with_any"]));
        Assert.Equal((new CommunityBand(8, 12), CommunityGroupSize.Babies50To99, 0.6m), (coarse.Band, coarse.GroupSize, coarse.Values["share_of_days_with_any"]));
    }

    [Theory]
    [InlineData(CommunityGroupSize.Babies20To49, false)]
    [InlineData(CommunityGroupSize.Babies50To99, false)]
    [InlineData(CommunityGroupSize.Babies100Plus, true)]
    public void View_CryingIsServedOnlyFromAHundredOrMore_AndAWithheldCellLooksAbsent(CommunityGroupSize babies, bool served)
    {
        var release = Release(Cell(Cry, 6, 13, babies, ("share_helped_by_cause.hunger", 0.4m), ("share_helped_by_cause.comfort", 0.6m)));

        var withheldOrServed = Of(CommunityServing.ViewFor(release, Shipped, ageWeeks: 8)!, Cry);
        var absent = Of(CommunityServing.ViewFor(Release(), Shipped, ageWeeks: 8)!, Cry);

        if (served)
        {
            Assert.Equal(["share_helped_by_cause.comfort", "share_helped_by_cause.hunger"], withheldOrServed.Cell!.Values.Keys);
        }
        else
        {
            Assert.Equal(absent, withheldOrServed);
        }
    }

    [Fact]
    public void Thresholds_AreOneTable_CryingAtAHundredOrMore_OthersFromAnyPublishedCell()
    {
        Assert.Equal(CommunityGroupSize.Babies100Plus, Assert.Single(CommunityServingThresholds.MinimumGroupSize, entry => entry.Key == Cry).Value);
        Assert.All(CommunityServingThresholds.MinimumGroupSize.Keys, key => Assert.Contains(key, Shipped.InV1.Select(statistic => statistic.Key)));
        Assert.True(CommunityServingThresholds.MayServe(Cell(Bottle, 8, 12, CommunityGroupSize.Babies20To49, ("p50", 120m))));
    }

    [Fact]
    public void View_KeepsOnlyV1Values()
    {
        var release = Release(Cell(Bottle, 8, 12, CommunityGroupSize.Babies50To99, ("p10", 80m), ("p25", 110m), ("p50", 130m), ("p75", 150m), ("p90", 190m)));

        var cell = Of(CommunityServing.ViewFor(release, Shipped, ageWeeks: 9)!, Bottle).Cell!;

        Assert.Equal(["p25", "p50", "p75"], cell.Values.Keys);
    }

    [Fact]
    public void View_ACellWithNoV1ValueIsNone()
    {
        var release = Release(Cell(Bottle, 8, 12, CommunityGroupSize.Babies50To99, ("p10", 80m)));

        Assert.Null(Of(CommunityServing.ViewFor(release, Shipped, ageWeeks: 9)!, Bottle).Cell);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(104)]
    [InlineData(500)]
    public void View_NotBornYetOrOlderThanTheGrid_HasNoCells(int? ageWeeks)
    {
        var release = Release(
            Cell(Bottle, 100, 104, CommunityGroupSize.Babies100Plus, ("p50", 200m)),
            Cell(Tummy, 100, 104, CommunityGroupSize.Babies100Plus, ("share_of_days_with_any", 0.5m)));

        var view = CommunityServing.ViewFor(release, Shipped, ageWeeks)!;

        Assert.All(view.Statistics, statistic => Assert.Null(statistic.Cell));
    }

    [Fact]
    public void View_PlaceholderOrAnotherCatalogVersion_IsNotServed()
    {
        Assert.Null(CommunityServing.ViewFor(CommunityRelease.Placeholder(Generated, Shipped.Version), Shipped, ageWeeks: 9));
        Assert.Null(CommunityServing.ViewFor(Release() with { CatalogVersion = Shipped.Version + 1 }, Shipped, ageWeeks: 9));
    }

    [Fact]
    public void NoV1StatisticHasADimension()
    {
        // The answer has no dimension value per cell: a v1 statistic with one would be served no cell until the contract says how.
        Assert.All(Shipped.InV1, statistic => Assert.Null(statistic.Band.Dimension));
    }
}
