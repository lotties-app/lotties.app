namespace Lotties.Domain.Catalog;

/// <summary>A page of products and the total number of products the list has.</summary>
public sealed record ProductPage(IReadOnlyList<Product> Items, int Total);

/// <summary>Persistence of the shared catalog (substances and products). Products are returned with their substances.</summary>
public interface ICatalogRepository
{
    /// <summary>Every substance (a small curated list), by English name; not tracked.</summary>
    Task<IReadOnlyList<Substance>> ListSubstancesAsync(CancellationToken cancellationToken = default);

    /// <summary>The product with <paramref name="productId"/>, merged or not; not tracked.</summary>
    Task<Product?> FindProductAsync(Guid productId, CancellationToken cancellationToken = default);

    /// <summary>The products with these ids (unknown ids are skipped); not tracked.</summary>
    Task<IReadOnlyList<Product>> FindProductsAsync(IReadOnlyCollection<Guid> productIds, CancellationToken cancellationToken = default);

    /// <summary>Up to <paramref name="take"/> products (merged included) selected by <paramref name="filter"/>, by normalized name; not tracked.</summary>
    Task<IReadOnlyList<Product>> FindNameCandidatesAsync(ProductCandidateFilter filter, int take, CancellationToken cancellationToken = default);

    /// <summary>Up to <paramref name="take"/> non-merged, active products containing any of <paramref name="substanceIds"/>, by name; not tracked.</summary>
    Task<IReadOnlyList<Product>> FindBySubstancesAsync(IReadOnlyCollection<Guid> substanceIds, int take, CancellationToken cancellationToken = default);

    /// <summary>
    /// Up to <paramref name="take"/> non-merged, active products whose substances are exactly <paramref name="substanceIds"/>
    /// (a non-empty set), official first, then by name; not tracked.
    /// </summary>
    Task<IReadOnlyList<Product>> FindWithSameSubstancesAsync(IReadOnlyCollection<Guid> substanceIds, int take, CancellationToken cancellationToken = default);

    /// <summary>
    /// Up to <paramref name="take"/> non-merged, active products sharing one of these ambiguous names
    /// (<see cref="Product.AmbiguousName"/>: the variants of a name used with different ingredients), official first; not tracked.
    /// </summary>
    Task<IReadOnlyList<Product>> FindAmbiguousVariantsAsync(IReadOnlyCollection<string> ambiguousNames, int take, CancellationToken cancellationToken = default);

    /// <summary>
    /// One page of the non-merged, active products containing <paramref name="substanceId"/> (combinations included),
    /// official first, then by name, and how many there are in total; not tracked.
    /// </summary>
    Task<ProductPage> ListContainingSubstanceAsync(Guid substanceId, CatalogPage page, CancellationToken cancellationToken = default);

    /// <summary>The non-merged product with this normalized name, form and country, if any; not tracked.</summary>
    Task<Product?> FindDuplicateAsync(string normalizedName, ProductForm form, CountryCode country, CancellationToken cancellationToken = default);

    /// <summary>
    /// Saves a new product. Returns <c>false</c>, leaving nothing tracked, when a concurrent insert of the same
    /// (normalized name, form, country) won the unique index.
    /// </summary>
    Task<bool> TryAddProductAsync(Product product, CancellationToken cancellationToken = default);
}
