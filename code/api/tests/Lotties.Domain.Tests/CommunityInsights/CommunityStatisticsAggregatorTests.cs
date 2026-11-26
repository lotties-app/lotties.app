using Lotties.Domain.CommunityInsights;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// The minimum group size of <see cref="CommunityStatisticsAggregator.AggregateCell"/> (docs/design/34-community-insights.md section 5):
/// a cell is published only with at least k distinct babies from at least k distinct families (a family is the babies sharing an
/// Owner, so twins count once); the family count needs k on every run, whatever the previous release had.
/// </summary>
public sealed class CommunityStatisticsAggregatorTests
{
    private const string Band = "w08";

    private static CommunityStatistic Statistic =>
        ShippedCommunityStatistics.Catalog.Statistics.Single(statistic => statistic.Key == "cry_outcome_by_cause") with { Epsilon = 0m };

    private static int K => Statistic.K;

    [Fact]
    public void AggregateCell_KBabiesFromKFamilies_IsPublished()
    {
        var cell = CommunityStatisticsAggregator.AggregateCell(Statistic, Band, null, Contributions(babies: K, families: K), 0);

        Assert.False(cell.Suppressed);
        Assert.Equal((K, K), (cell.DistinctBabies, cell.DistinctFamilies));
    }

    [Fact]
    public void AggregateCell_KBabiesFromOneFamilyLess_IsSuppressed()
    {
        // K babies, two of them twins of one Owner: K - 1 families, and no family near the dominance threshold.
        var cell = CommunityStatisticsAggregator.AggregateCell(Statistic, Band, null, Contributions(babies: K, families: K - 1), 0);

        Assert.True(cell.Suppressed);
        Assert.Equal($"below_k_families_{K}", cell.SuppressionReason);
    }

    [Fact]
    public void AggregateCell_FewerThanKFamilies_IsSuppressedEvenWhenThePreviousReleaseHadKBabies()
    {
        var cell = CommunityStatisticsAggregator.AggregateCell(Statistic, Band, null, Contributions(babies: K + 2, families: K - 1), previousDistinctBabiesForHysteresis: K + 2);

        Assert.True(cell.Suppressed);
        Assert.Equal($"below_k_families_{K}", cell.SuppressionReason);
    }

    [Fact]
    public void Aggregate_AppliesTheFamilyRuleToEveryBand()
    {
        var cells = CommunityStatisticsAggregator.Aggregate(
            Statistic,
            new Dictionary<string, IReadOnlyList<BabyContribution>>
            {
                ["w08"] = Contributions(babies: K, families: K),
                ["w09"] = Contributions(babies: K, families: K - 1),
            },
            0);

        Assert.Equal([false, true], cells.OrderBy(cell => cell.BandKey, StringComparer.Ordinal).Select(cell => cell.Suppressed));
    }

    /// <summary>
    /// One value per baby; babies are spread over <paramref name="families"/> families, the first families taking the extra babies.
    /// </summary>
    private static IReadOnlyList<BabyContribution> Contributions(int babies, int families)
    {
        var familyIds = Enumerable.Range(0, families).Select(_ => Guid.NewGuid()).ToArray();
        return [.. Enumerable.Range(0, babies).Select(index => new BabyContribution(Guid.NewGuid(), familyIds[index % families], 0.5m))];
    }
}
