using Lotties.Domain.CommunityInsights;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>SplitMix64: a small seedable generator, so a statistical test is the same on every run and every runtime.</summary>
internal sealed class SeededRandomSource(ulong seed) : ICommunityRandomSource
{
    private ulong state = seed;

    public ulong NextBits()
    {
        state += 0x9E3779B97F4A7C15UL;
        var mixed = state;
        mixed = (mixed ^ (mixed >> 30)) * 0xBF58476D1CE4E5B9UL;
        mixed = (mixed ^ (mixed >> 27)) * 0x94D049BB133111EBUL;
        return mixed ^ (mixed >> 31);
    }

    /// <summary>A uniform integer in [0, <paramref name="bound"/>).</summary>
    public int Next(int bound) => (int)(NextBits() % (ulong)bound);
}

/// <summary>A source that always returns the same word (all zero bits, all one bits, ...), for the extremes of the sampler.</summary>
internal sealed class ConstantRandomSource(ulong bits) : ICommunityRandomSource
{
    public ulong NextBits() => bits;
}

/// <summary>No noise: the exact sums, so a test can check the counting and weighting rules on exact shares.</summary>
internal sealed class ExactNoise : ICommunityNoise
{
    public double Perturb(double exact, double scale) => exact;

    public double Jitter(double halfWidth) => 0.0;
}

/// <summary>Exact sums, and every scale it was asked for, in call order.</summary>
internal sealed class RecordingNoise : ICommunityNoise
{
    public List<double> Scales { get; } = [];

    public double Perturb(double exact, double scale)
    {
        Scales.Add(scale);
        return exact;
    }

    public double Jitter(double halfWidth) => 0.0;
}

/// <summary>A synthetic baby and her family.</summary>
internal sealed record TestBaby(Guid Baby, Guid Family);

/// <summary>Builders for the aggregation tests: babies, families, days, and runs over the shipped catalog.</summary>
internal static class CommunityFixtures
{
    public const string Tummy = "tummy_minutes_per_day";

    public const string Cry = "cry_outcome_by_cause";

    public static readonly DateOnly FirstDay = new(2026, 9, 7);

    public static CommunityCapKey CapKey { get; } = CommunityCapKey.From(Enumerable.Range(1, 32).Select(value => (byte)value).ToArray());

    public static CommunityStatisticsCatalog Catalog => ShippedCommunityStatistics.Catalog;

    /// <summary>One distinct family per baby.</summary>
    public static IReadOnlyList<Guid> Families(int count) => [.. Enumerable.Range(0, count).Select(_ => Guid.NewGuid())];

    /// <summary><paramref name="babies"/> babies spread over <paramref name="families"/> families (the first families take the extra babies).</summary>
    public static IReadOnlyList<TestBaby> NewBabies(int babies, int families)
    {
        var familyIds = Families(families);
        return [.. Enumerable.Range(0, babies).Select(index => new TestBaby(Guid.NewGuid(), familyIds[index % families]))];
    }

    /// <summary>One tummy day per baby at <paramref name="ageWeeks"/>, with tummy time on the first <paramref name="withTummy"/> babies.</summary>
    public static IReadOnlyList<CommunityTummyTimeDay> TummyDays(IReadOnlyList<TestBaby> babies, int ageWeeks, int withTummy, int days = 1) =>
        [.. babies.SelectMany((baby, index) => Enumerable.Range(0, days).Select(day =>
            new CommunityTummyTimeDay(baby.Baby, baby.Family, ageWeeks, FirstDay.AddDays(day), index < withTummy ? 20m : 0m)))];

    /// <summary>One spell per baby on <paramref name="day"/> (default the first day), at <paramref name="ageWeeks"/>, helped by <paramref name="cause"/>.</summary>
    public static IReadOnlyList<CommunityCrySpell> Spells(IReadOnlyList<TestBaby> babies, int ageWeeks, string cause, int day = 0) =>
        [.. babies.Select(baby => new CommunityCrySpell(baby.Baby, baby.Family, ageWeeks, FirstDay.AddDays(day), cause))];

    /// <summary>When the test runs are generated: inside 2026-Q4, so the percentile window is 2026-07-01 to 2026-09-30.</summary>
    public static readonly DateTimeOffset GeneratedAt = new(2026, 11, 29, 3, 30, 0, TimeSpan.Zero);

    /// <summary>The first day of the percentile window of <see cref="GeneratedAt"/>.</summary>
    public static readonly DateOnly WindowStart = new(2026, 7, 1);

    public static CommunityAggregationInput Input(
        IReadOnlyList<CommunityTummyTimeDay>? tummy = null,
        IReadOnlyList<CommunityCrySpell>? spells = null,
        IReadOnlyList<CommunityBottleFeed>? bottles = null,
        IReadOnlyList<CommunityRoutineDay>? routines = null) =>
        new(Catalog, GeneratedAt, CapKey, tummy ?? [], spells ?? [], bottles ?? [], routines ?? []);

    /// <summary>Formula bottles: one per baby and day for <paramref name="days"/> days from <paramref name="first"/> (default the window start), all at <paramref name="ageWeeks"/>.</summary>
    public static IReadOnlyList<CommunityBottleFeed> Bottles(IReadOnlyList<TestBaby> babies, int ageWeeks, Func<int, decimal> mlOfBaby, int days = 1, DateOnly? first = null, string kind = "formula") =>
        [.. babies.SelectMany((baby, index) => Enumerable.Range(0, days).Select(day =>
            new CommunityBottleFeed(baby.Baby, baby.Family, ageWeeks, (first ?? WindowStart).AddDays(day), kind, mlOfBaby(index))))];

    /// <summary>Routine days with night sleep only, one per baby and day from <paramref name="first"/> (default the window start).</summary>
    public static IReadOnlyList<CommunityRoutineDay> Nights(IReadOnlyList<TestBaby> babies, int ageWeeks, Func<int, decimal> minutesOfBaby, int days = 1, DateOnly? first = null) =>
        [.. babies.SelectMany((baby, index) => Enumerable.Range(0, days).Select(day =>
            new CommunityRoutineDay(baby.Baby, baby.Family, ageWeeks, (first ?? WindowStart).AddDays(day), minutesOfBaby(index), null, null)))];

    public static CommunityRelease Run(CommunityAggregationInput input, ICommunityNoise? noise = null) =>
        CommunityStatisticsAggregator.Aggregate(input, noise ?? new ExactNoise()).Release;

    public static IReadOnlyList<CommunityReleaseCell> CellsOf(CommunityRelease release, string statistic) =>
        [.. release.Cells.Where(cell => cell.Statistic == statistic)];

    public static CommunityReleaseCell? Cell(CommunityRelease release, string statistic, int fromWeeks, int toWeeks, string? dimension = null) =>
        release.Cells.SingleOrDefault(cell => cell.Statistic == statistic && cell.Band == new CommunityBand(fromWeeks, toWeeks) && cell.Dimension == dimension);
}
