namespace Lotties.Domain.CommunityInsights;

/// <summary>One cell of one output that passed every rule, with its population (never published) and its noisy values.</summary>
internal sealed record CommunityOutputCell(CommunityCellKey Key, CommunityCellPopulation Population, IReadOnlyDictionary<string, decimal> Values);

/// <summary>
/// Which cells of one output are published (docs/design/34-community-insights.md section 5 "k" and "Bands"):
/// <list type="bullet">
/// <item>a fine cell with a value is published when its population meets the minimum: <see cref="CommunityStatistic.K"/>
/// distinct babies from as many families, or <see cref="CommunityStatistic.KHysteresis"/> when the previous release published
/// this output in this band and dimension value (hysteresis, babies and families alike), and no family holds more than
/// <see cref="CommunityStatisticsAggregator.FamilyDominanceThreshold"/> of its weight (dominance);</item>
/// <item>a coarse cell is a fallback only for a fine cell that is not published. It is published when it meets the same rule and so
/// does what is left of it once its published fine cells are taken out (complementary suppression: no group below the minimum can
/// be recovered as the coarse cell minus the fine ones). When that remainder is too small, the published fine cells with the
/// fewest babies are withdrawn into it one by one; when even the whole coarse cell fails, no coarse cell is published and the fine
/// cells stay as they were.</item>
/// </list>
/// No totals across bands or dimension values are published, so no other differencing is possible within a release.
/// </summary>
internal static class CommunityPublication
{
    public static IReadOnlyList<CommunityOutputCell> Decide(
        CommunityStatistic statistic,
        string output,
        CommunityCellGrid grid,
        IReadOnlyDictionary<CommunityCellKey, CommunityCellPopulation> populations,
        IReadOnlyDictionary<CommunityCellKey, IReadOnlyDictionary<string, decimal>> values,
        CommunityPreviousRelease previous)
    {
        var rule = new Rule(statistic, output, previous);
        var passing = grid.FineCells.Where(cell => values.ContainsKey(cell) && populations[cell].Meets(rule.MinimumFor(cell))).ToArray();
        var fallbacks = grid.CoarseCells.Select(coarse => Fallback(coarse, passing, populations, values, rule)).Where(fallback => fallback is not null).ToArray();
        var withdrawn = fallbacks.SelectMany(fallback => fallback!.Withdrawn).ToHashSet();
        var fine = passing.Where(cell => !withdrawn.Contains(cell)).Select(cell => new CommunityOutputCell(cell, populations[cell], values[cell]));
        return [.. fine, .. fallbacks.Select(fallback => fallback!.Cell)];
    }

    private static CoarseFallback? Fallback(
        CommunityCoarseCell coarse,
        IReadOnlyList<CommunityCellKey> passing,
        IReadOnlyDictionary<CommunityCellKey, CommunityCellPopulation> populations,
        IReadOnlyDictionary<CommunityCellKey, IReadOnlyDictionary<string, decimal>> values,
        Rule rule)
    {
        var published = coarse.FineCells.Where(passing.Contains).ToArray();
        var whole = CommunityCellPopulation.Union(coarse.FineCells.Select(cell => populations[cell]));
        var minimum = rule.MinimumFor(coarse.Key);
        if (published.Length == coarse.FineCells.Count || !values.TryGetValue(coarse.Key, out var coarseValues) || !whole.Meets(minimum))
        {
            return null;
        }

        var bySize = published.OrderBy(cell => populations[cell].Babies.Count).ThenBy(cell => cell.Band.FromWeeks).ToArray();
        return Enumerable.Range(0, bySize.Length + 1)
            .Select(count => bySize.Take(count).ToArray())
            .Where(withdrawn => RemainderMeets(coarse, published.Except(withdrawn), populations, minimum))
            .Select(withdrawn => new CoarseFallback(new CommunityOutputCell(coarse.Key, whole, coarseValues), withdrawn))
            .FirstOrDefault();
    }

    private static bool RemainderMeets(
        CommunityCoarseCell coarse,
        IEnumerable<CommunityCellKey> stillPublished,
        IReadOnlyDictionary<CommunityCellKey, CommunityCellPopulation> populations,
        int minimum)
    {
        var kept = stillPublished.ToHashSet();
        return CommunityCellPopulation.Union(coarse.FineCells.Where(cell => !kept.Contains(cell)).Select(cell => populations[cell])).Meets(minimum);
    }

    private sealed record CoarseFallback(CommunityOutputCell Cell, IReadOnlyList<CommunityCellKey> Withdrawn);

    /// <summary>The minimum of one cell: k, or the hysteresis minimum when the previous release published this output there.</summary>
    private sealed record Rule(CommunityStatistic Statistic, string Output, CommunityPreviousRelease Previous)
    {
        public int MinimumFor(CommunityCellKey cell) =>
            Previous.WasPublished(Statistic.Key, cell.Band, cell.Dimension, Output) ? Statistic.KHysteresis : Statistic.K;
    }
}
