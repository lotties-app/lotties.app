using Lotties.Domain.CommunityInsights;
using static Lotties.Domain.Tests.CommunityInsights.CommunityFixtures;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// Property tests of the publication rules over many random populations near the thresholds (seeded, so every run is the same):
/// every published cell, recomputed here from the input, has at least k = 20 distinct babies from as many families (no hysteresis),
/// no family above a quarter of its weight, the right group-size bucket, and, for a coarse fallback, a remainder (the coarse cell
/// minus its published fine cells) that meets the same minimum.
/// </summary>
public sealed class CommunityPublicationPropertyTests
{
    private const int Seeds = 60;

    private const int Minimum = 20;

    private const double Dominance = (double)CommunityStatisticsAggregator.FamilyDominanceThreshold;

    [Fact]
    public void PublishedCells_NeverFallBelowTheThresholds()
    {
        var published = Enumerable.Range(1, Seeds).SelectMany(seed => CheckOneWorld((ulong)seed)).ToArray();

        // Not vacuous: the random worlds publish fine cells, coarse fallbacks and cry cells.
        Assert.True(published.Count(cell => cell.Statistic == Tummy && cell.Band.Weeks == 1) > Seeds, "too few fine cells published");
        Assert.True(published.Count(cell => cell.Statistic == Tummy && cell.Band.Weeks > 1) > Seeds / 4, "too few coarse cells published");
        Assert.True(published.Count(cell => cell.Statistic == Cry) > Seeds, "too few cry cells published");
    }

    private static IReadOnlyList<CommunityReleaseCell> CheckOneWorld(ulong seed)
    {
        var random = new SeededRandomSource(seed);
        var world = World.Generate(random);
        var release = Run(Input(tummy: world.TummyDays, spells: world.Spells), new SnappedLaplaceNoise(new SeededRandomSource(seed + 1000)));

        Assert.All(release.Cells, cell => CheckCell(cell, release, world, seed));
        return release.Cells;
    }

    private static void CheckCell(CommunityReleaseCell cell, CommunityRelease release, World world, ulong seed)
    {
        var babies = new HashSet<Guid>();
        foreach (var output in cell.OutputNames)
        {
            var samples = world.SamplesOf(cell.Statistic);
            var inCell = samples.Where(sample => cell.Band.Contains(sample.AgeWeeks)).ToArray();
            AssertMeets(Population(inCell), $"seed {seed}: {cell.Statistic} {cell.Band} {output}");
            CheckRemainder(cell, output, release, samples, seed);
            babies.UnionWith(inCell.Select(sample => sample.Baby));
        }

        Assert.Equal(CommunityGroupSizes.Of(babies.Count), cell.Babies);
    }

    /// <summary>A coarse tummy cell (4 weeks wide over weekly fine bands) minus its published fine cells must meet the minimum.</summary>
    private static void CheckRemainder(CommunityReleaseCell cell, string output, CommunityRelease release, IReadOnlyList<Sample> samples, ulong seed)
    {
        if (cell.Statistic != Tummy || cell.Band.Weeks == 1)
        {
            return;
        }

        var publishedFine = release.Cells
            .Where(other => other.Statistic == cell.Statistic && other.OutputNames.Contains(output) && other.Band != cell.Band && cell.Band.Holds(other.Band))
            .Select(other => other.Band)
            .ToArray();
        var remainder = Population(samples.Where(sample => cell.Band.Contains(sample.AgeWeeks) && !publishedFine.Any(band => band.Contains(sample.AgeWeeks))));
        AssertMeets(remainder, $"seed {seed}: remainder of {cell.Statistic} {cell.Band} {output}");
    }

    private static void AssertMeets(Counted population, string where)
    {
        Assert.True(population.Babies >= Minimum, $"{where}: {population.Babies} babies < {Minimum}");
        Assert.True(population.Families >= Minimum, $"{where}: {population.Families} families < {Minimum}");
        Assert.True(population.LargestFamilyShare <= Dominance + 1e-12, $"{where}: one family has {population.LargestFamilyShare:P1}");
    }

    private static Counted Population(IEnumerable<Sample> samples)
    {
        var list = samples.ToArray();
        var familyWeights = list.GroupBy(sample => sample.Family).Select(family => family.Sum(sample => sample.Weight)).ToArray();
        var total = familyWeights.Sum();
        return new Counted(list.Select(sample => sample.Baby).Distinct().Count(), familyWeights.Length, total <= 0 ? 0 : familyWeights.DefaultIfEmpty().Max() / total);
    }

    private sealed record Counted(int Babies, int Families, double LargestFamilyShare);

    /// <summary>One observation as the oracle sees it, with its weight (1 / the baby's observations of the statistic's output).</summary>
    private sealed record Sample(Guid Baby, Guid Family, int AgeWeeks, double Weight);

    /// <summary>
    /// Babies near the thresholds: per week 3 to 30 babies, a third of them also a week older, families mostly of one baby with
    /// some siblings and a day care Owner; 1 to 5 days or spells per baby and band (the cap of 14 days never binds, so the oracle
    /// needs no cap).
    /// </summary>
    private sealed record World(IReadOnlyList<CommunityTummyTimeDay> TummyDays, IReadOnlyList<CommunityCrySpell> Spells)
    {
        public static World Generate(SeededRandomSource random)
        {
            var families = new List<Guid> { Guid.NewGuid() };
            var dayCare = families[0];
            var tummy = new List<CommunityTummyTimeDay>();
            var spells = new List<CommunityCrySpell>();
            foreach (var week in Enumerable.Range(0, 12))
            {
                var babies = Enumerable.Range(0, 3 + random.Next(28)).Select(_ => new TestBaby(Guid.NewGuid(), FamilyOf(random, families, dayCare))).ToArray();
                tummy.AddRange(babies.SelectMany(baby => TummyOf(random, baby, week)));
                spells.AddRange(babies.SelectMany(baby => SpellsOf(random, baby, week)));
            }

            return new World(tummy, spells);
        }

        public IReadOnlyList<Sample> SamplesOf(string statistic) =>
            statistic == Tummy
                ? [.. TummyDays.GroupBy(day => day.BabyId).SelectMany(baby => baby.Select(day => new Sample(day.BabyId, day.FamilyId, day.AgeWeeks, 1.0 / baby.Count())))]
                : [.. Spells.GroupBy(spell => spell.BabyId).SelectMany(baby => baby.Select(spell => new Sample(spell.BabyId, spell.FamilyId, spell.AgeWeeks, 1.0 / baby.Count())))];

        private static Guid FamilyOf(SeededRandomSource random, List<Guid> families, Guid dayCare)
        {
            var roll = random.Next(10);
            var family = roll switch
            {
                0 or 1 => dayCare,
                2 => families[random.Next(families.Count)],
                _ => Guid.NewGuid(),
            };
            families.Add(family);
            return family;
        }

        private static IEnumerable<CommunityTummyTimeDay> TummyOf(SeededRandomSource random, TestBaby baby, int week)
        {
            var weeks = random.Next(3) == 0 && week < 11 ? new[] { week, week + 1 } : [week];
            return weeks.SelectMany(age => Enumerable.Range(0, 1 + random.Next(5))
                .Select(day => new CommunityTummyTimeDay(baby.Baby, baby.Family, age, FirstDay.AddDays((age * 7) + day), random.Next(2) * 15m)));
        }

        private static IEnumerable<CommunityCrySpell> SpellsOf(SeededRandomSource random, TestBaby baby, int week) =>
            Enumerable.Range(0, 1 + random.Next(5)).Select(spell => new CommunityCrySpell(
                baby.Baby,
                baby.Family,
                week,
                FirstDay.AddDays((week * 7) + spell),
                CommunityCryCauses.Helped[random.Next(CommunityCryCauses.Helped.Count)]));
    }
}
