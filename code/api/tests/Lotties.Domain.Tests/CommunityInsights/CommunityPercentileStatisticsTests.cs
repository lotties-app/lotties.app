using Lotties.Domain.CommunityInsights;
using static Lotties.Domain.Tests.CommunityInsights.CommunityFixtures;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// The percentile statistics as built (tier C, owner decisions of 2026-11-27, design 34 section 5.1.1) through the real core: p25,
/// p50 and p75 per 4-week cell from formula bottles and routine days of the previous calendar quarter only, at most 4 cells per baby
/// chosen from her own data, k = 20 babies from 20 families, and the neighbouring-dataset property the epsilon rests on (removing one
/// baby moves one count of each of her at most 4 cells, and nothing else).
/// </summary>
public sealed class CommunityPercentileStatisticsTests
{
    private const string Bottle = "bottle_ml_per_feed";

    private const string Night = "night_sleep_minutes";

    private static CommunityStatistic StatisticOf(string key) => CommunityFixtures.Catalog.Statistics.Single(statistic => statistic.Key == key);

    private static IReadOnlyList<CommunityCellSample> Bounded(CommunityAggregationInput input, string key)
    {
        var statistic = StatisticOf(key);
        return CommunityStatisticsAggregator.BoundedSamples(input, statistic, CommunityCellGrid.For(CommunityFixtures.Catalog.BandGrids, statistic));
    }

    [Fact]
    public void Bottles_TwentyFormulaBabies_PublishTheQuartilesOfTheirMedians()
    {
        var babies = NewBabies(20, 20);
        var release = Run(Input(bottles: Bottles(babies, 9, index => 100m + (10m * index), days: 3)));

        var cell = Assert.Single(CellsOf(release, Bottle));
        var edges = CommunityHistogram.Edges(0, 400, 10, 20);
        var expected = CommunityHistogram.Read(CommunityHistogram.Counts(Enumerable.Range(0, 20).Select(index => 100.0 + (10 * index)), edges), edges, 0, 400, 10)!;
        Assert.Equal(new CommunityBand(8, 12), cell.Band);
        Assert.Equal(expected.Select(value => (decimal)value), [cell.Outputs["p25"], cell.Outputs["p50"], cell.Outputs["p75"]]);
        Assert.Equal(["p25", "p50", "p75"], cell.Outputs.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(CommunityGroupSize.Babies20To49, cell.Babies);
    }

    [Theory]
    [InlineData(19, 19)]
    [InlineData(20, 19)]
    public void Bottles_BelowTwentyBabiesOrFamilies_PublishNothing(int babies, int families)
    {
        var release = Run(Input(bottles: Bottles(NewBabies(babies, families), 9, index => 120m + index)));

        Assert.Empty(CellsOf(release, Bottle));
    }

    [Fact]
    public void Bottles_BreastMilk_IsNotRead()
    {
        var babies = NewBabies(25, 25);
        var formulaOnly = Run(Input(bottles: Bottles(babies, 9, index => 100m + (5m * index))));
        var withBreastMilk = Run(Input(bottles: [.. Bottles(babies, 9, index => 100m + (5m * index)), .. Bottles(NewBabies(40, 40), 9, _ => 30m, kind: "breast_milk")]));
        var breastMilkOnly = Run(Input(bottles: Bottles(NewBabies(40, 40), 9, _ => 30m, kind: "breast_milk")));

        Assert.Equal(CommunityReleaseJson.Serialize(formulaOnly), CommunityReleaseJson.Serialize(withBreastMilk));
        Assert.Empty(CellsOf(breastMilkOnly, Bottle));
    }

    [Theory]
    [InlineData("2026-06-30", false)]
    [InlineData("2026-07-01", true)]
    [InlineData("2026-09-30", true)]
    [InlineData("2026-10-01", false)]
    [InlineData("2026-11-28", false)]
    public void Window_OnlyThePreviousCalendarQuartersLocalDaysAreRead(string day, bool read)
    {
        var date = DateOnly.Parse(day, System.Globalization.CultureInfo.InvariantCulture);
        var release = Run(Input(routines: Nights(NewBabies(25, 25), 30, index => 560m + index, first: date)));

        Assert.Equal(read, CellsOf(release, Night).Count == 1);
    }

    [Fact]
    public void Window_TheShareStatisticsAreNotWindowed()
    {
        var release = Run(Input(tummy: [.. TummyDays(NewBabies(20, 20), 100, 10)]));

        Assert.Single(CellsOf(release, Tummy));
        Assert.Equal(new DateOnly(2026, 9, 7), FirstDay);
    }

    [Fact]
    public void CellBound_ABabyInFiveBands_KeepsTheFourWithMostDays()
    {
        // Her quarter touches five 4-week bands (weeks 2 to 18); the band with the fewest days (16-20, one day) is dropped.
        var baby = NewBabies(1, 1)[0];
        var nights = new (int Age, int Days)[] { (3, 6), (6, 7), (10, 7), (14, 5), (17, 1) }
            .SelectMany((band, index) => Enumerable.Range(0, band.Days).Select(day => new CommunityRoutineDay(baby.Baby, baby.Family, band.Age, WindowStart.AddDays((index * 14) + day), 600m, null, null)))
            .ToArray();

        var cells = Bounded(Input(routines: nights), Night).Select(sample => sample.Cell.Band).Distinct().OrderBy(band => band.FromWeeks).ToArray();

        Assert.Equal([new CommunityBand(0, 4), new CommunityBand(4, 8), new CommunityBand(8, 12), new CommunityBand(12, 16)], cells);
    }

    [Fact]
    public void CellBound_DependsOnlyOnTheBabysOwnData_AndTiesAreKeyed()
    {
        // Five bands of three days each: which four she keeps is decided by the keyed rank alone, the same with or without others.
        var baby = NewBabies(1, 1)[0];
        var hers = Enumerable.Range(0, 5)
            .SelectMany(band => Enumerable.Range(0, 3).Select(day => new CommunityRoutineDay(baby.Baby, baby.Family, (band * 4) + 1, WindowStart.AddDays((band * 7) + day), 600m, null, null)))
            .ToArray();
        var others = Nights(NewBabies(60, 50), 5, index => 500m + index, days: 20);

        var alone = Bounded(Input(routines: hers), Night).Select(sample => sample.Cell).Distinct().ToHashSet();
        var together = Bounded(Input(routines: [.. hers, .. others]), Night).Where(sample => sample.BabyId == baby.Baby).Select(sample => sample.Cell).Distinct().ToHashSet();
        var otherKey = Bounded(Input(routines: hers) with { CapKey = CommunityCapKey.From(Enumerable.Repeat((byte)99, 32).ToArray()) }, Night).Select(sample => sample.Cell).Distinct().ToHashSet();

        Assert.Equal(4, alone.Count);
        Assert.Equal(alone, together);
        Assert.Equal(4, otherKey.Count);
    }

    [Fact]
    public void CellBound_NoBabyIsInMoreThanFourCells_InRandomWorlds()
    {
        foreach (var seed in Enumerable.Range(1, 20))
        {
            var random = new SeededRandomSource((ulong)seed);
            var babies = NewBabies(80, 70);
            var nights = babies.SelectMany(baby => Enumerable.Range(0, 92).Where(_ => random.Next(3) > 0)
                .Select(day => new CommunityRoutineDay(baby.Baby, baby.Family, random.Next(104), WindowStart.AddDays(day), 400m + random.Next(400), null, null))).ToArray();

            var perBaby = Bounded(Input(routines: nights), Night).GroupBy(sample => sample.BabyId).Select(baby => baby.Select(sample => sample.Cell).Distinct().Count());

            Assert.All(perBaby, cells => Assert.InRange(cells, 1, CommunityStatisticsValidator.MaxCellsPerBabyC));
        }
    }

    [Fact]
    public void Neighbours_RemovingOneBaby_MovesOneCountOfEachOfHerCellsAndNothingElse()
    {
        var random = new SeededRandomSource(41);
        var babies = NewBabies(120, 100);
        var nights = babies.SelectMany(baby =>
        {
            var age = random.Next(90);
            return Enumerable.Range(0, 92).Where(_ => random.Next(4) > 0)
                .Select(day => new CommunityRoutineDay(baby.Baby, baby.Family, age + (day / 7), WindowStart.AddDays(day), 420m + random.Next(300), null, null));
        }).ToArray();
        var edges = CommunityHistogram.Edges(0, 960, 10, 30);
        var with = Summaries(Bounded(Input(routines: nights), Night));

        foreach (var target in babies.Take(12))
        {
            var without = Summaries(Bounded(Input(routines: [.. nights.Where(night => night.BabyId != target.Baby)]), Night));
            var hers = with.Where(cell => cell.Value.ContainsKey(target.Baby)).Select(cell => cell.Key).ToHashSet();

            Assert.InRange(hers.Count, 0, 4);
            Assert.All(with.Keys.Union(without.Keys), cell =>
            {
                var before = CommunityHistogram.Counts(with.GetValueOrDefault(cell, []).Values, edges);
                var after = CommunityHistogram.Counts(without.GetValueOrDefault(cell, []).Values, edges);
                Assert.Equal(hers.Contains(cell) ? 1.0 : 0.0, before.Zip(after).Sum(pair => Math.Abs(pair.First - pair.Second)));
                Assert.All(without.GetValueOrDefault(cell, []), other => Assert.Equal(with[cell][other.Key], other.Value));
            });
        }
    }

    [Fact]
    public void Noise_ANonPositiveNoisyTotal_PublishesNothing()
    {
        var release = Run(Input(bottles: Bottles(NewBabies(30, 30), 9, index => 120m + index)), new NegativeNoise());

        Assert.Empty(CellsOf(release, Bottle));
    }

    [Fact]
    public void Noise_RealNoise_KeepsQuartilesOrderedOnTheStepAndInRange()
    {
        var babies = NewBabies(40, 40);
        var release = Run(Input(bottles: Bottles(babies, 9, index => 90m + (4m * index), days: 5)), new SnappedLaplaceNoise(new SeededRandomSource(8)));

        var cell = Assert.Single(CellsOf(release, Bottle));
        Assert.True(cell.Outputs["p25"] <= cell.Outputs["p50"] && cell.Outputs["p50"] <= cell.Outputs["p75"]);
        Assert.All(cell.Outputs.Values, value => Assert.Equal(0m, value % 10m));
        Assert.All(cell.Outputs.Values, value => Assert.InRange(value, 0m, 400m));
    }

    /// <summary>Each baby's median per cell, as the histogram mechanism summarises them.</summary>
    private static Dictionary<CommunityCellKey, Dictionary<Guid, double>> Summaries(IReadOnlyList<CommunityCellSample> samples) =>
        samples.GroupBy(sample => sample.Cell).ToDictionary(
            cell => cell.Key,
            cell => cell.GroupBy(sample => sample.BabyId).ToDictionary(baby => baby.Key, baby => CommunityHistogram.Median([.. baby.Select(sample => sample.Value)])));

    /// <summary>Every noisy count is -1: the noisy total is never positive.</summary>
    private sealed class NegativeNoise : ICommunityNoise
    {
        public double Perturb(double exact, double scale) => -1.0;

        public double Jitter(double halfWidth) => 0.0;
    }
}
