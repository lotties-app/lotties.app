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

/// <summary>
/// How safe an alternative with the same active ingredients is to read as "the same" (best first). Only
/// <see cref="Equivalent"/> means same ingredients, same strength and same known form; the others are labelled
/// differences or unknowns and are never shown as equivalent.
/// </summary>
public enum AlternativeLevel
{
    Equivalent,
    DifferentForm,
    StrengthNotKnown,
    DifferentStrength,
}

/// <summary>A product with the same active ingredients as another, and how it compares (<see cref="AlternativeLevel"/>).</summary>
public sealed record ProductAlternative(Product Product, AlternativeLevel Level);

/// <summary>A substance matched by a search.</summary>
public sealed record SubstanceMatch(Substance Substance, int Rank, int Distance);

/// <summary>A page of a list: skip <see cref="Offset"/> rows, return at most <see cref="Limit"/>.</summary>
public sealed record CatalogPage(int Offset, int Limit)
{
    public const int DefaultLimit = 20;
    public const int MaxLimit = 50;
    public const int MaxOffset = 100_000;

    /// <summary>Defaults 0 and <see cref="DefaultLimit"/>; throws <see cref="DomainValidationException"/> (<c>offset</c>/<c>limit</c>) out of range.</summary>
    public static CatalogPage From(int? offset, int? limit) => new(
        offset switch
        {
            null => 0,
            >= 0 and <= MaxOffset => offset.Value,
            _ => throw new DomainValidationException("offset", $"offset must be between 0 and {MaxOffset}."),
        },
        limit switch
        {
            null => DefaultLimit,
            >= 1 and <= MaxLimit => limit.Value,
            _ => throw new DomainValidationException("limit", $"limit must be between 1 and {MaxLimit}."),
        });
}

/// <summary>
/// Pure ranking of the shared catalog search over a bounded candidate set loaded by the repository
/// (<see cref="CatalogQuery.CandidateFilter"/>, products of the matched substances). Names are compared by
/// <see cref="ProductNames.Key"/>: equal, prefix of the name, then typo distance with the importer's tolerance
/// (<see cref="MedicationNameMatcher.Tolerance"/>: keys up to 3 characters exact, up to 7 one edit, longer two).
/// Merged products resolve to their target; retired official products (<see cref="Product.IsActive"/> false) are
/// never offered. Order: rank, distance, name (case-insensitive), id.
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

    /// <summary>Order of lists of products: official first, then curated, then the rest (<see cref="Product.SourceRank"/>), by name (case-insensitive), then id.</summary>
    public static IOrderedEnumerable<Product> OfficialFirst(IEnumerable<Product> products) =>
        products
            .OrderBy(product => product.SourceRank)
            .ThenBy(product => product.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(product => product.Id);

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

    /// <summary>
    /// The substances any of whose names (key, en, pt-BR, synonyms) match the query, best first. Typo matches count only
    /// when no name matched exactly or by prefix: "simeticona" must not also bring dimeticona (one letter apart) and its
    /// products into "products with this ingredient".
    /// </summary>
    public static IReadOnlyList<SubstanceMatch> MatchSubstances(CatalogQuery query, IReadOnlyList<Substance> substances)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(substances);
        var matches = substances
            .Select(substance => BestSubstanceMatch(query, substance))
            .OfType<SubstanceMatch>()
            .ToArray();
        var hasCloseMatch = matches.Any(match => match.Rank < CatalogNameMatch.TypoRank);
        return matches
            .Where(match => !hasCloseMatch || match.Rank < CatalogNameMatch.TypoRank)
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
            .Where(match => match.Product.IsActive)
            .OrderBy(match => match.Rank)
            .ThenBy(match => match.Distance)
            .ThenBy(match => match.Product.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(match => match.Product.Id)
            .DistinctBy(match => match.Product.Id)
            .Take(limit)
            .ToArray();
    }

    /// <summary>
    /// Puts every variant of an ambiguous name next to its first result matched by name or alias: products sharing a
    /// source name with different ingredients (<see cref="Product.AmbiguousName"/>) are shown together, so the parent
    /// sees all of them and their ingredients. Substance matches are not expanded (the other variants do not contain the
    /// searched ingredient). Variants already listed are not repeated; they may take the list past the search limit.
    /// </summary>
    public static IReadOnlyList<ProductMatch> WithAmbiguousVariants(IReadOnlyList<ProductMatch> matches, IReadOnlyList<Product> variants)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(variants);
        var byName = variants
            .Where(variant => variant.AmbiguousName is not null && variant.IsActive && !variant.IsMerged)
            .GroupBy(variant => variant.AmbiguousName!, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => OfficialFirst(group).ToArray(), StringComparer.Ordinal);
        return matches
            .SelectMany(match => Expanded(match, byName))
            .DistinctBy(match => match.Product.Id)
            .ToArray();
    }

    /// <summary>The ambiguous names among the results matched by name or alias (whose variants should be loaded).</summary>
    public static IReadOnlyList<string> AmbiguousNames(IReadOnlyList<ProductMatch> matches)
    {
        ArgumentNullException.ThrowIfNull(matches);
        return matches
            .Where(match => match.MatchedBy != CatalogMatchKind.Substance)
            .Select(match => match.Product.AmbiguousName)
            .OfType<string>()
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private static IEnumerable<ProductMatch> Expanded(ProductMatch match, IReadOnlyDictionary<string, Product[]> variants) =>
        match.MatchedBy != CatalogMatchKind.Substance && match.Product.AmbiguousName is { } name && variants.TryGetValue(name, out var group)
            ? [match, .. group.Select(variant => new ProductMatch(variant, match.MatchedBy, match.Rank, match.Distance))]
            : [match];

    /// <summary>
    /// The products of <see cref="Alternatives"/> without their levels (same order, same cap).
    /// </summary>
    public static IReadOnlyList<Product> SameActiveIngredient(Product product, IReadOnlyList<Product> pool) =>
        Alternatives(product, pool).Select(alternative => alternative.Product).ToArray();

    /// <summary>
    /// Other non-merged, active products of <paramref name="pool"/> with exactly the same active ingredients, one per
    /// name (the best level of a brand's forms), each with its explicit <see cref="AlternativeLevel"/> and never silent:
    /// <list type="number">
    /// <item><see cref="AlternativeLevel.Equivalent"/>: same ingredient set, same structured strength (<see cref="Product.StrengthKey"/>)
    /// and the same <em>known</em> form (form "other" means unknown and never counts);</item>
    /// <item><see cref="AlternativeLevel.DifferentForm"/>: same strength, but the form differs or is not known;</item>
    /// <item><see cref="AlternativeLevel.StrengthNotKnown"/>: either side has no structured strength, or the two are
    /// not comparable (another unit family: 0,9% is not turned into mg/mL);</item>
    /// <item><see cref="AlternativeLevel.DifferentStrength"/>: both strengths known and different.</item>
    /// </list>
    /// Within a level, products in the same known form as <paramref name="product"/> come first, then official, curated,
    /// the rest, then by name. At most <see cref="MaxSiblings"/> are returned, best levels first, so a different-strength
    /// product is never listed ahead of an equivalent one. Every alternative is information only, never a substitution:
    /// the doctor's prescription is the only source of a dose, and the app never picks an alternative for the user.
    /// Different ingredient sets (homeopathic, supplement, combinations) are never alternatives.
    /// </summary>
    public static IReadOnlyList<ProductAlternative> Alternatives(Product product, IReadOnlyList<Product> pool)
    {
        ArgumentNullException.ThrowIfNull(product);
        ArgumentNullException.ThrowIfNull(pool);
        var candidates = pool.Where(candidate => candidate.Id != product.Id
            && candidate.NormalizedName != product.NormalizedName
            && !candidate.IsMerged
            && candidate.IsActive
            && product.HasSameActiveIngredientsAs(candidate));
        return candidates
            .DistinctBy(candidate => candidate.Id)
            .Select(candidate => new ProductAlternative(candidate, LevelOf(product, candidate)))
            .OrderBy(alternative => alternative.Level)
            .ThenBy(alternative => IsSameKnownForm(product, alternative.Product) ? 0 : 1)
            .ThenBy(alternative => alternative.Product.SourceRank)
            .ThenBy(alternative => alternative.Product.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(alternative => alternative.Product.Id)
            .DistinctBy(alternative => alternative.Product.NormalizedName, StringComparer.Ordinal)
            .Take(MaxSiblings)
            .ToArray();
    }

    /// <summary>The level of <paramref name="candidate"/> as an alternative to <paramref name="product"/> (same ingredient sets assumed).</summary>
    public static AlternativeLevel LevelOf(Product product, Product candidate)
    {
        ArgumentNullException.ThrowIfNull(product);
        ArgumentNullException.ThrowIfNull(candidate);
        return product.CompareStrengthTo(candidate) switch
        {
            StrengthComparison.Unknown => AlternativeLevel.StrengthNotKnown,
            StrengthComparison.Different => AlternativeLevel.DifferentStrength,
            _ => IsSameKnownForm(product, candidate) ? AlternativeLevel.Equivalent : AlternativeLevel.DifferentForm,
        };
    }

    private static bool IsSameKnownForm(Product product, Product candidate) =>
        product.Form != ProductForm.Other && candidate.Form == product.Form;

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
