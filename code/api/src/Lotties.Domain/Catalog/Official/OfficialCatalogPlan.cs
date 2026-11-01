namespace Lotties.Domain.Catalog.Official;

/// <summary>
/// One imported catalog product. For ANVISA: the included records of one product name with one ingredient set in one
/// form (the same brand is often registered several times, and one registration covers several forms).
/// <see cref="ExternalRef"/> is the stable key <c>{normalized name}:{form}</c> in <see cref="Source"/>;
/// <see cref="AmbiguousName"/> is set when products with other ingredients share the source name (the name then
/// carries the ingredients); <see cref="RegistrationNumbers"/> are kept for the report only (empty for notified products).
/// </summary>
public sealed record CatalogProductPlan(
    string Source,
    ProductStatus Status,
    string ExternalRef,
    string Name,
    string NormalizedName,
    ProductForm Form,
    string? Presentation,
    IReadOnlyList<string> SubstanceKeys,
    IReadOnlyList<string> RegistrationNumbers,
    string? AmbiguousName);

/// <summary>A text and how often it occurred (report samples).</summary>
public sealed record SampleCount(string Text, int Count);

/// <summary>Counts and samples of a plan, printed by the importer's dry run.</summary>
public sealed record OfficialCatalogReport
{
    public int SourceRows { get; init; }

    /// <summary>Rows without a registration number (notified low-risk products).</summary>
    public int RowsWithoutRegistration { get; init; }

    /// <summary>Active notified rows (no registration number): imported by name, without ingredients unless the row lists them.</summary>
    public int ActiveNotifiedRows { get; init; }

    public int Registrations { get; init; }

    public int ActiveRegistrations { get; init; }

    /// <summary>Registrations without any active row: left out (their rows only feed ingredient inheritance).</summary>
    public int ExcludedRegistrations { get; init; }

    /// <summary>Excluded registrations that the CMED price list still prices (on the market but inactive in the registry).</summary>
    public int ExcludedPricedRegistrations { get; init; }

    /// <summary>Active registrations whose active rows list no ingredient but another row of the same registration does.</summary>
    public int InheritedIngredientRegistrations { get; init; }

    /// <summary>Active registrations without any ingredient in any of their rows (imported without ingredients).</summary>
    public int RegistrationsWithoutIngredients { get; init; }

    /// <summary>Active registrations without CMED presentations: their form is <see cref="ProductForm.Other"/>.</summary>
    public int RegistrationsWithoutPresentations { get; init; }

    public int PresentationRows { get; init; }

    /// <summary>CMED presentations whose registration is not an included registration.</summary>
    public int PresentationsWithoutRegistration { get; init; }

    /// <summary>Records whose name has no letters or digits to match on.</summary>
    public int SkippedNames { get; init; }

    /// <summary>"Other" fallbacks dropped because the same name and ingredients have a form from the price list.</summary>
    public int DroppedFallbacks { get; init; }

    public int Products { get; init; }

    public IReadOnlyDictionary<ProductForm, int> ProductsByForm { get; init; } = new Dictionary<ProductForm, int>();

    public int Substances { get; init; }

    public int CuratedSubstances { get; init; }

    /// <summary>Names shared by included records with different ingredient sets (split into variants).</summary>
    public int AmbiguousNames { get; init; }

    public int AmbiguousProducts { get; init; }

    public int ProductsWithoutIngredients { get; init; }

    /// <summary>Products with more than <see cref="Product.OfficialMaxSubstances"/> ingredients: kept without links.</summary>
    public int ProductsWithTooManyIngredients { get; init; }

    public int NamesWithPresentation { get; init; }

    public IReadOnlyList<SampleCount> OtherFormSamples { get; init; } = [];

    public IReadOnlyList<string> MultiIngredientSamples { get; init; } = [];

    public IReadOnlyList<string> PresentationSplitSamples { get; init; } = [];

    public IReadOnlyList<string> AmbiguousNameSamples { get; init; } = [];
}

/// <summary>What the importer writes: the products, the substances they need and the report.</summary>
public sealed record OfficialCatalogPlan(
    IReadOnlyList<CatalogProductPlan> Products,
    IReadOnlyList<SubstanceDefinition> Substances,
    OfficialCatalogReport Report)
{
    /// <summary>This plan with more products and substances (e.g. the curated list), substances distinct by key.</summary>
    public OfficialCatalogPlan With(IReadOnlyList<CatalogProductPlan> products, IReadOnlyList<SubstanceDefinition> substances)
    {
        ArgumentNullException.ThrowIfNull(products);
        ArgumentNullException.ThrowIfNull(substances);
        return this with
        {
            Products = [.. Products, .. products],
            Substances = Substances.Concat(substances).DistinctBy(substance => substance.Key, StringComparer.Ordinal).OrderBy(substance => substance.Key, StringComparer.Ordinal).ToArray(),
        };
    }

    /// <summary>Products of different sources with the same catalog key (normalized name, form): the importer writes only the first.</summary>
    public IReadOnlyList<string> KeyCollisions() =>
        Products
            .GroupBy(product => (product.NormalizedName, product.Form))
            .Where(group => group.Count() > 1)
            .Select(group => $"{group.First().Name} ({OfficialCatalogPlanner.FormCode(group.Key.Form)}): {string.Join(", ", group.Select(product => $"{product.Source}/{product.ExternalRef}"))}")
            .ToArray();

    /// <summary>
    /// Spot check: products whose name key starts with the query key, then products with a substance whose key or names
    /// start with it, by name (at most <paramref name="max"/>).
    /// </summary>
    public IReadOnlyList<CatalogProductPlan> Find(string query, int max)
    {
        ArgumentNullException.ThrowIfNull(query);
        var key = ProductNames.Key(query);
        if (key.Length < ProductNames.MinKeyLength)
        {
            return [];
        }

        var substanceKeys = Substances.Where(substance => SubstanceMatches(substance, key)).Select(substance => substance.Key).ToHashSet(StringComparer.Ordinal);
        return Products
            .Select(product => (product, rank: product.NormalizedName.StartsWith(key, StringComparison.Ordinal) ? 0 : product.SubstanceKeys.Any(substanceKeys.Contains) ? 1 : 2))
            .Where(entry => entry.rank < 2)
            .OrderBy(entry => entry.rank)
            .ThenBy(entry => entry.product.NormalizedName, StringComparer.Ordinal)
            .ThenBy(entry => entry.product.Form)
            .Take(max)
            .Select(entry => entry.product)
            .ToArray();
    }

    private static bool SubstanceMatches(SubstanceDefinition substance, string key) =>
        new[] { substance.Key, substance.NameEn, substance.NamePtBr }.Concat(substance.Synonyms)
            .Any(name => ProductNames.Key(name).StartsWith(key, StringComparison.Ordinal));
}
