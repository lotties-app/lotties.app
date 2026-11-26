using Lotties.Domain.CommunityInsights;
using static Lotties.Domain.Tests.CommunityInsights.CommunityFixtures;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// Property tests of the publication rules over many random populations near the thresholds (seeded, so every run is the same):
/// every published cell, recomputed here from the input, has at least k (or, published before, the hysteresis minimum) distinct
/// babies from as many families, no family above a quarter of its weight, the right group-size bucket, and, for a coarse
/// fallback, a remainder (the coarse cell minus its published fine cells) that meets the same minimum.
/// </summary>
public sealed class CommunityPublicationPropertyTests
{
    private const int Seeds = 60;

    private const double Dominance = (double)CommunityStatisticsAggregator.FamilyDominanceThreshold;

    [Fact]
    public void PublishedCells_NeverFallBelowTheThresholds()
    {
        var published = Enumerable.Range(1, Seeds).SelectMany(seed => CheckOneWorld((ulong)seed)).ToArray();

        // Not vacuous: the random worlds publish fine cells, coarse fallbacks and cells kept by hysteresis.
        Assert.True(published.Count(cell => cell.Statistic == Tummy && cell.Band.Weeks == 1) > Seeds, "too few fine cells published");
        Assert.True(published.Count(cell => cell.Statistic == Tummy && cell.Band.Weeks > 1) > Seeds / 4, "too few coarse cells published");
        Assert.True(published.Count(cell => cell.Statistic == Cry) > Seeds, "too few cry cells published");
    }

    private static IReadOnlyList<CommunityReleaseCell> CheckOneWorld(ulong seed)
    {
        var random = new SeededRandomSource(seed);
        var world = World.Generate(random);
        var previous = PreviousRelease(random);
        var release = Run(Input(tummy: world.TummyDays, spells: world.Spells, previous: previous), new SnappedLaplaceNoise(new SeededRandomSource(seed + 1000)));

        Assert.All(release.Cells, cell => CheckCell(cell, release, world, previous, seed));
        return release.Cells;
    }

    private static void CheckCell(CommunityReleaseCell cell, CommunityRelease release, World world, CommunityPreviousRelease previous, ulong seed)
    {
        var babies = new HashSet<Guid>();
        foreach (var output in cell.OutputNames)
        {
            var samples = world.SamplesOf(cell.Statistic, output);
            var minimum = previous.WasPublished(cell.Statistic, cell.Band, cell.Dimension, output) ? 18 : 20;
            var inCell = samples.Where(sample => cell.Band.Contains(sample.AgeWeeks) && sample.Dimension == cell.Dimension).ToArray();
            AssertMeets(Population(inCell), minimum, $"seed {seed}: {cell.Statistic} {cell.Band} {cell.Dimension} {output}");
            CheckRemainder(cell, output, release, samples, minimum, seed);
            babies.UnionWith(inCell.Select(sample => sample.Baby));
        }

        Assert.Equal(CommunityGroupSizes.Of(babies.Count), cell.Babies);
    }

    /// <summary>A coarse tummy cell (4 weeks wide over weekly fine bands) minus its published fine cells must meet the minimum.</summary>
    private static void CheckRemainder(CommunityReleaseCell cell, string output, CommunityRelease release, IReadOnlyList<Sample> samples, int minimum, ulong seed)
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
        AssertMeets(remainder, minimum, $"seed {seed}: remainder of {cell.Statistic} {cell.Band} {output}");
    }

    private static void AssertMeets(Counted population, int minimum, string where)
    {
        Assert.True(population.Babies >= minimum, $"{where}: {population.Babies} babies < {minimum}");
        Assert.True(population.Families >= minimum, $"{where}: {population.Families} families < {minimum}");
        Assert.True(population.LargestFamilyShare <= Dominance + 1e-12, $"{where}: one family has {population.LargestFamilyShare:P1}");
    }

    private static Counted Population(IEnumerable<Sample> samples)
    {
        var list = samples.ToArray();
        var familyWeights = list.GroupBy(sample => sample.Family).Select(family => family.Sum(sample => sample.Weight)).ToArray();
        var total = familyWeights.Sum();
        return new Counted(list.Select(sample => sample.Baby).Distinct().Count(), familyWeights.Length, total <= 0 ? 0 : familyWeights.DefaultIfEmpty().Max() / total);
    }

    /// <summary>A random set of cells the "previous release" published, so the hysteresis minimum is exercised.</summary>
    private static CommunityPreviousRelease PreviousRelease(SeededRandomSource random)
    {
        var tummy = Enumerable.Range(0, 12).Where(_ => random.Next(3) == 0)
            .Select(week => Cell(Tummy, new CommunityBand(week, week + 1), null, CommunityOutputs.ShareOfDaysWithAny))
            .Concat(Enumerable.Range(0, 3).Where(_ => random.Next(3) == 0).Select(band => Cell(Tummy, new CommunityBand(band * 4, (band * 4) + 4), null, CommunityOutputs.ShareOfDaysWithAny)));
        var cry = CommunityPartsOfDay.All.Where(_ => random.Next(2) == 0)
            .Select(part => Cell(Cry, new CommunityBand(0, 6), part, $"{CommunityOutputs.ShareHelpedByCause}.hunger"));
        var cells = tummy.Concat(cry).ToArray();
        var release = new CommunityRelease(DateTimeOffset.UnixEpoch, 2, false, [new(Tummy, 20, 18, 5m), new(Cry, 20, 18, 0.2m)], cells);
        return CommunityPreviousRelease.From(release);
    }

    private static CommunityReleaseCell Cell(string statistic, CommunityBand band, string? dimension, string value) =>
        new(statistic, band, dimension, new Dictionary<string, decimal> { [value] = 0.5m }, CommunityGroupSize.Babies20To49);

    private sealed record Counted(int Babies, int Families, double LargestFamilyShare);

    /// <summary>One observation as the oracle sees it, with its weight (1 / the baby's observations of that output).</summary>
    private sealed record Sample(Guid Baby, Guid Family, int AgeWeeks, string? Dimension, double Weight);

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

        public IReadOnlyList<Sample> SamplesOf(string statistic, string output) =>
            statistic == Tummy ? TummySamples() : CrySamples(output);

        private IReadOnlyList<Sample> TummySamples() =>
            [.. TummyDays.GroupBy(day => day.BabyId).SelectMany(baby => baby.Select(day => new Sample(day.BabyId, day.FamilyId, day.AgeWeeks, null, 1.0 / baby.Count())))];

        private IReadOnlyList<Sample> CrySamples(string output)
        {
            var read = output == CommunityOutputs.ShareSuggestedEqualsHelped ? Spells.Where(spell => spell.SuggestedCause is not null) : Spells;
            return [.. read.GroupBy(spell => spell.BabyId).SelectMany(baby => baby.Select(spell => new Sample(spell.BabyId, spell.FamilyId, spell.AgeWeeks, spell.PartOfDay, 1.0 / baby.Count())))];
        }

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
                CommunityPartsOfDay.All[random.Next(2)],
                CommunityCryCauses.Helped[random.Next(CommunityCryCauses.Helped.Count)],
                random.Next(2) == 0 ? null : CommunityCryCauses.Suggestable[random.Next(CommunityCryCauses.Suggestable.Count)]));
    }
}
