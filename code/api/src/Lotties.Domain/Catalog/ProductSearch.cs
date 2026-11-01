using Lotties.Domain.Exceptions;
using Lotties.Domain.Imports;

namespace Lotties.Domain.Catalog;

/// <summary>What a catalog search result matched: the product's own name, the name of a product merged into it, or one of its substances.</summary>
public enum CatalogMatchKind
{
    Name,
    Alias,
    Substance,
}

/// <summary>How a key matched a name: <see cref="Rank"/> 0 equal, 1 prefix (search as you type), 2 typo within tolerance.</summary>
public sealed record CatalogNameMatch(int Rank, int Distance)
{
    public const int ExactRank = 0;
    public const int PrefixRank = 1;
    public const int TypoRank = 2;
    public const int SubstanceRank = 3;
}

/// <summary>A ranked catalog search result; <see cref="Distance"/> is the edit distance of a typo match (0 otherwise).</summary>
public sealed record ProductMatch(Product Product, CatalogMatchKind MatchedBy, int Rank, int Distance);

/// <summary>A substance matched by a search.</summary>
public sealed record SubstanceMatch(Substance Substance, int Rank, int Distance);

/// <summary>
/// Pure ranking of the shared catalog search over a bounded candidate set loaded by the repository
/// (<see cref="CatalogQuery.CandidateFilter"/>, products of the matched substances). Names are compared by
/// <see cref="ProductNames.Key"/>: equal, prefix of the name, then typo distance with the importer's tolerance
/// (<see cref="MedicationNameMatcher.Tolerance"/>: keys up to 3 characters exact, up to 7 one edit, longer two).
/// Merged products resolve to their target. Order: rank, distance, name (case-insensitive), id.
/// </summary>
public static class ProductSearch
{
    public const int DefaultLimit = 10;
    public const int MaxLimit = 20;

    /// <summary>Most rows one candidate query (by name, or by substance) may load.</summary>
    public const int MaxCandidates = 200;

    /// <summary>Most siblings listed per result as having the same active ingredient.</summary>
    public const int MaxSiblings = 10;

    public static int ValidLimit(int? limit) => limit switch
    {
        null => DefaultLimit,
        >= 1 and <= MaxLimit => limit.Value,
        _ => throw new DomainValidationException("limit", $"limit must be between 1 and {MaxLimit}."),
    };

    /// <summary>How <paramref name="queryKey"/> matches the name key <paramref name="nameKey"/>, or <c>null</c>.</summary>
    public static CatalogNameMatch? MatchName(string queryKey, string nameKey)
    {
        ArgumentNullException.ThrowIfNull(queryKey);
        ArgumentNullException.ThrowIfNull(nameKey);
        return (queryKey, nameKey) switch
        {
            _ when nameKey == queryKey => new CatalogNameMatch(CatalogNameMatch.ExactRank, 0),
            _ when nameKey.StartsWith(queryKey, StringComparison.Ordinal) => new CatalogNameMatch(CatalogNameMatch.PrefixRank, 0),
            _ => MedicationNameMatcher.DistanceWithinTolerance(queryKey, nameKey) is { } distance ? new CatalogNameMatch(CatalogNameMatch.TypoRank, distance) : null,
        };
    }

    /// <summary>The substances any of whose names (key, en, pt-BR, synonyms) match the query, best first.</summary>
    public static IReadOnlyList<SubstanceMatch> MatchSubstances(CatalogQuery query, IReadOnlyList<Substance> substances)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(substances);
        return substances
            .Select(substance => BestSubstanceMatch(query, substance))
            .OfType<SubstanceMatch>()
            .OrderBy(match => match.Rank)
            .ThenBy(match => match.Distance)
            .ThenBy(match => match.Substance.NameEn, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    /// <summary>
    /// Ranks the products. <paramref name="nameCandidates"/> may contain merged products, which resolve through
    /// <paramref name="mergeTargets"/> (unknown targets are dropped); <paramref name="substanceProducts"/> contain the
    /// matched substances. Each product appears once, with its best match.
    /// </summary>
    public static IReadOnlyList<ProductMatch> Rank(
        CatalogQuery query,
        IReadOnlyList<Product> nameCandidates,
        IReadOnlyList<Product> mergeTargets,
        IReadOnlyList<Product> substanceProducts,
        int limit)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(nameCandidates);
        ArgumentNullException.ThrowIfNull(mergeTargets);
        ArgumentNullException.ThrowIfNull(substanceProducts);
        var targets = mergeTargets.Where(target => !target.IsMerged).DistinctBy(target => target.Id).ToDictionary(target => target.Id);
        var byName = nameCandidates.Select(candidate => NameMatchOrNull(query, candidate, targets)).OfType<ProductMatch>();
        var bySubstance = substanceProducts.Where(product => !product.IsMerged).Select(product => new ProductMatch(product, CatalogMatchKind.Substance, CatalogNameMatch.SubstanceRank, 0));
        return byName.Concat(bySubstance)
            .OrderBy(match => match.Rank)
            .ThenBy(match => match.Distance)
            .ThenBy(match => match.Product.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(match => match.Product.Id)
            .DistinctBy(match => match.Product.Id)
            .Take(limit)
            .ToArray();
    }

    /// <summary>Other non-merged products of <paramref name="pool"/> with exactly the same active ingredients, by name.</summary>
    public static IReadOnlyList<Product> SameActiveIngredient(Product product, IReadOnlyList<Product> pool)
    {
        ArgumentNullException.ThrowIfNull(product);
        ArgumentNullException.ThrowIfNull(pool);
        return pool
            .Where(candidate => candidate.Id != product.Id && !candidate.IsMerged && product.HasSameActiveIngredientsAs(candidate))
            .DistinctBy(candidate => candidate.Id)
            .OrderBy(candidate => candidate.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(candidate => candidate.Id)
            .Take(MaxSiblings)
            .ToArray();
    }

    private static ProductMatch? NameMatchOrNull(CatalogQuery query, Product candidate, IReadOnlyDictionary<Guid, Product> targets)
    {
        if (MatchName(query.Key, candidate.NormalizedName) is not { } match)
        {
            return null;
        }

        return candidate.MergedIntoId is { } targetId
            ? AliasMatchOrNull(targets.GetValueOrDefault(targetId), match)
            : new ProductMatch(candidate, CatalogMatchKind.Name, match.Rank, match.Distance);
    }

    private static ProductMatch? AliasMatchOrNull(Product? target, CatalogNameMatch match) =>
        target is null ? null : new ProductMatch(target, CatalogMatchKind.Alias, match.Rank, match.Distance);

    private static SubstanceMatch? BestSubstanceMatch(CatalogQuery query, Substance substance) =>
        substance.SearchNames
            .Select(name => MatchName(query.Key, ProductNames.Key(name)))
            .OfType<CatalogNameMatch>()
            .OrderBy(match => match.Rank)
            .ThenBy(match => match.Distance)
            .Select(match => new SubstanceMatch(substance, match.Rank, match.Distance))
            .FirstOrDefault();
}
