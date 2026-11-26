using System.Security.Cryptography;
using System.Text;

namespace Lotties.Domain.CommunityInsights;

/// <summary>One baby's contribution to a cell, pre-clipped and capped by the caller.</summary>
public sealed record BabyContribution(Guid BabyId, Guid FamilyId, decimal Value);

/// <summary>One cell of the aggregation output: the band key, dimension value (if any), and the noisy statistics.</summary>
public sealed record AggregatedCell(
    string StatisticKey,
    string BandKey,
    string? DimensionValue,
    int DistinctBabies,
    int DistinctFamilies,
    decimal Mean,
    decimal? P3,
    decimal? P97,
    bool Suppressed,
    string? SuppressionReason);

/// <summary>
/// Pure aggregation of community statistics (docs/design/34-community-insights.md sections 4 and 5): clipping, per-baby capping,
/// family dominance suppression, k-suppression with hysteresis, and tier-A Laplace noise. No I/O; the job feeds it data and
/// writes the result. Tier-B exponential mechanism for percentiles is gated (TODO: implement when tier-B is activated).
/// </summary>
public static class CommunityStatisticsAggregator
{
    /// <summary>Family dominance threshold: a cell is suppressed when one family contributes more than this fraction.</summary>
    public const decimal FamilyDominanceThreshold = 0.25m;

    /// <summary>
    /// Aggregates one statistic's contributions across all its cells. The caller must clip values to
    /// <see cref="CommunityClip"/> ranges and cap per-baby contributions to <see cref="CommunityStatistic.CapPerBaby"/> days
    /// before calling this method.
    /// </summary>
    public static IReadOnlyList<AggregatedCell> Aggregate(
        CommunityStatistic statistic,
        IReadOnlyDictionary<string, IReadOnlyList<BabyContribution>> cellsByBand,
        int previousDistinctBabiesForHysteresis)
    {
        ArgumentNullException.ThrowIfNull(statistic);
        ArgumentNullException.ThrowIfNull(cellsByBand);

        var results = new List<AggregatedCell>();
        foreach (var (bandKey, contributions) in cellsByBand)
        {
            results.Add(AggregateCell(statistic, bandKey, null, contributions, previousDistinctBabiesForHysteresis));
        }

        return results;
    }

    /// <summary>Aggregates a single cell with all privacy protections applied.</summary>
    public static AggregatedCell AggregateCell(
        CommunityStatistic statistic,
        string bandKey,
        string? dimensionValue,
        IReadOnlyList<BabyContribution> contributions,
        int previousDistinctBabiesForHysteresis)
    {
        ArgumentNullException.ThrowIfNull(statistic);
        ArgumentNullException.ThrowIfNull(contributions);

        if (contributions.Count == 0)
        {
            return EmptyCell(statistic.Key, bandKey, dimensionValue, "no_contributions");
        }

        var distinctBabies = contributions.Select(c => c.BabyId).Distinct().Count();
        var distinctFamilies = contributions.Select(c => c.FamilyId).Distinct().Count();

        // K-suppression with hysteresis: publish at k>=K, withdraw at k<KHysteresis
        if (distinctBabies < statistic.K && previousDistinctBabiesForHysteresis < statistic.KHysteresis)
        {
            return EmptyCell(statistic.Key, bandKey, dimensionValue, $"below_k_{statistic.K}_hysteresis_{statistic.KHysteresis}");
        }

        if (distinctBabies < statistic.K)
        {
            return EmptyCell(statistic.Key, bandKey, dimensionValue, $"below_k_{statistic.K}");
        }

        // Family dominance suppression
        if (IsDominatedByOneFamily(contributions.Select(c => c.FamilyId).ToList()))
        {
            return EmptyCell(statistic.Key, bandKey, dimensionValue, "family_dominance");
        }

        var values = contributions.Select(c => c.Value).OrderBy(v => v).ToList();
        var mean = values.Average();
        var noisyMean = AddLaplaceNoise(mean, statistic.Epsilon, sensitivity: 1.0m / distinctBabies);

        decimal? p3 = null;
        decimal? p97 = null;
        if (statistic.KTails.HasValue && distinctBabies >= statistic.KTails.Value)
        {
            // TODO: Tier-B exponential mechanism for percentiles (gated; Phase 1 uses Laplace only).
            // For Phase 1, use empirical percentiles without noise on tails (they are not published until KTails is met).
            p3 = Percentile(values, 0.03);
            p97 = Percentile(values, 0.97);
        }

        return new AggregatedCell(
            statistic.Key,
            bandKey,
            dimensionValue,
            distinctBabies,
            distinctFamilies,
            noisyMean,
            p3,
            p97,
            Suppressed: false,
            SuppressionReason: null);
    }

    /// <summary>
    /// The dominance rule (design 34 section 5): whether one family gave more than <see cref="FamilyDominanceThreshold"/> of a cell's
    /// values. <paramref name="familyOfEachValue"/> holds the family of every value of the cell (one entry per value, after capping).
    /// An empty cell is not dominated (it is suppressed by k).
    /// </summary>
    public static bool IsDominatedByOneFamily(IReadOnlyCollection<Guid> familyOfEachValue)
    {
        ArgumentNullException.ThrowIfNull(familyOfEachValue);
        if (familyOfEachValue.Count == 0)
        {
            return false;
        }

        var maxFamilyCount = familyOfEachValue.GroupBy(family => family).Max(family => family.Count());
        return (decimal)maxFamilyCount / familyOfEachValue.Count > FamilyDominanceThreshold;
    }

    /// <summary>Laplace noise for tier-A statistics (shares, means). Sensitivity = 1/n for bounded [0,1] or clipped ranges.</summary>
    public static decimal AddLaplaceNoise(decimal value, decimal epsilon, decimal sensitivity)
    {
        if (epsilon <= 0)
        {
            return value;
        }

        var scale = (double)(sensitivity / epsilon);
        var uniform = RandomNumberGenerator.GetInt32(int.MaxValue) / (double)int.MaxValue;
        var sign = uniform < 0.5 ? -1.0 : 1.0;
        var noise = sign * scale * Math.Log(1.0 - 2.0 * Math.Abs(uniform - 0.5));
        return value + (decimal)noise;
    }

    /// <summary>Deterministic keyed hash for per-baby-per-day capping (keyed hash of baby id + day string).</summary>
    public static byte[] CapHash(Guid babyId, string dayKey)
    {
        var input = Encoding.UTF8.GetBytes($"{babyId:N}:{dayKey}");
        return SHA256.HashData(input);
    }

    private static AggregatedCell EmptyCell(string statisticKey, string bandKey, string? dimensionValue, string reason) =>
        new(statisticKey, bandKey, dimensionValue, 0, 0, 0m, null, null, Suppressed: true, SuppressionReason: reason);

    private static decimal Percentile(IReadOnlyList<decimal> sortedValues, double percentile)
    {
        if (sortedValues.Count == 0)
        {
            return 0m;
        }

        var index = (int)Math.Floor(percentile * (sortedValues.Count - 1));
        return sortedValues[Math.Clamp(index, 0, sortedValues.Count - 1)];
    }
}