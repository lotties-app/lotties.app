using Lotties.Application.Users;
using Lotties.Domain.Catalog;
using Lotties.Domain.Exceptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Catalog;

/// <summary>The shared, instance-wide medication catalog. Callers are authenticated; no baby access is involved.</summary>
public interface ICatalogService
{
    /// <summary>
    /// Fuzzy product search (name, merged aliases, substance names, typos) with "same active ingredient" siblings; every
    /// variant of an ambiguous name follows its first name match, so all of them show together.
    /// </summary>
    Task<IReadOnlyList<ProductSearchResult>> SearchProductsAsync(string? query, int? limit, CancellationToken cancellationToken = default);

    /// <summary>Every curated substance, or those matching <paramref name="query"/> (best first).</summary>
    Task<IReadOnlyList<SubstanceResponse>> SearchSubstancesAsync(string? query, CancellationToken cancellationToken = default);

    /// <summary>The product; throws <see cref="ProductNotFoundException"/> when unknown.</summary>
    Task<ProductResponse> GetProductAsync(Guid productId, CancellationToken cancellationToken = default);

    /// <summary>
    /// One page of the active products containing the substance (combinations included), official first, then by name;
    /// throws <see cref="CatalogSubstanceNotFoundException"/> when the substance is unknown. Information only.
    /// </summary>
    Task<SubstanceProductsResponse> ListProductsWithSubstanceAsync(Guid substanceId, int? offset, int? limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// Creates a community product unless a non-merged product with the same normalized name, form and country exists;
    /// then that product is returned with <see cref="CreateProductResult.Created"/> <c>false</c> (also when a concurrent
    /// request created it first).
    /// </summary>
    Task<CreateProductResult> CreateProductAsync(CreateProductRequest request, CancellationToken cancellationToken = default);
}

internal sealed class CatalogService : ICatalogService
{
    /// <summary>Rows loaded per substance set for the siblings: enough for <see cref="ProductSearch.MaxSiblings"/> distinct names.</summary>
    private const int SiblingCandidates = ProductSearch.MaxSiblings * 5;

    private readonly ICatalogRepository _catalog;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<CatalogService> _logger;

    public CatalogService(ICatalogRepository catalog, ICurrentUser currentUser, TimeProvider timeProvider, ILogger<CatalogService> logger)
    {
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<ProductSearchResult>> SearchProductsAsync(string? query, int? limit, CancellationToken cancellationToken = default)
    {
        var search = CatalogQuery.From(query);
        var take = ProductSearch.ValidLimit(limit);
        var substances = await LoadSubstancesAsync(cancellationToken);
        var matchedSubstanceIds = ProductSearch.MatchSubstances(search, substances.Values.ToArray()).Select(match => match.Substance.Id).ToArray();
        var nameCandidates = await _catalog.FindNameCandidatesAsync(search.CandidateFilter, ProductSearch.MaxCandidates, cancellationToken);
        var mergeTargets = await _catalog.FindProductsAsync(MergeTargetIds(nameCandidates), cancellationToken);
        var bySubstance = await _catalog.FindBySubstancesAsync(matchedSubstanceIds, ProductSearch.MaxCandidates, cancellationToken);
        var ranked = ProductSearch.Rank(search, nameCandidates, mergeTargets, bySubstance, take);
        var variants = await _catalog.FindAmbiguousVariantsAsync(ProductSearch.AmbiguousNames(ranked), ProductSearch.MaxCandidates, cancellationToken);
        var matches = ProductSearch.WithAmbiguousVariants(ranked, variants);
        var siblingPool = await LoadSiblingPoolAsync(matches, cancellationToken);
        _logger.LogDebug("Catalog search matched {MatchCount} products", matches.Count);
        return matches.Select(match => CatalogMapper.ToSearchResult(match, ProductSearch.SameActiveIngredient(match.Product, siblingPool), substances)).ToArray();
    }

    public async Task<SubstanceProductsResponse> ListProductsWithSubstanceAsync(Guid substanceId, int? offset, int? limit, CancellationToken cancellationToken = default)
    {
        var page = CatalogPage.From(offset, limit);
        var substances = await LoadSubstancesAsync(cancellationToken);
        var substance = substances.GetValueOrDefault(substanceId) ?? throw new CatalogSubstanceNotFoundException(substanceId);
        var products = await _catalog.ListContainingSubstanceAsync(substance.Id, page, cancellationToken);
        return CatalogMapper.ToSubstanceProducts(substance, products, page, substances);
    }

    public async Task<IReadOnlyList<SubstanceResponse>> SearchSubstancesAsync(string? query, CancellationToken cancellationToken = default)
    {
        var substances = await _catalog.ListSubstancesAsync(cancellationToken);
        return string.IsNullOrWhiteSpace(query)
            ? substances.Select(substance => (SubstanceResponse)substance).ToArray()
            : ProductSearch.MatchSubstances(CatalogQuery.From(query), substances).Select(match => (SubstanceResponse)match.Substance).ToArray();
    }

    public async Task<ProductResponse> GetProductAsync(Guid productId, CancellationToken cancellationToken = default)
    {
        var product = await _catalog.FindProductAsync(productId, cancellationToken) ?? throw new ProductNotFoundException(productId);
        return CatalogMapper.ToResponse(product, await LoadSubstancesAsync(cancellationToken));
    }

    public async Task<CreateProductResult> CreateProductAsync(CreateProductRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var substances = await LoadSubstancesAsync(cancellationToken);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var product = Product.CreateCommunity(
            request.Name ?? string.Empty,
            request.Form ?? throw new DomainValidationException("form", "form is required."),
            CountryCode.From(request.Country),
            Ingredients(request),
            substances.Keys.ToHashSet(),
            user.Id,
            _timeProvider.GetUtcNow());
        var existing = await _catalog.FindDuplicateAsync(product.NormalizedName, product.Form, product.Country, cancellationToken);
        return existing is null
            ? await AddAsync(product, substances, cancellationToken)
            : Existing(existing, substances);
    }

    private async Task<CreateProductResult> AddAsync(Product product, IReadOnlyDictionary<Guid, Substance> substances, CancellationToken cancellationToken)
    {
        if (await _catalog.TryAddProductAsync(product, cancellationToken))
        {
            _logger.LogInformation("Created community product {ProductId}", product.Id);
            return new CreateProductResult(CatalogMapper.ToResponse(product, substances), Created: true);
        }

        var winner = await _catalog.FindDuplicateAsync(product.NormalizedName, product.Form, product.Country, cancellationToken)
            ?? throw new InvalidOperationException($"Product '{product.NormalizedName}' was reported as existing but could not be loaded.");
        return Existing(winner, substances);
    }

    private CreateProductResult Existing(Product existing, IReadOnlyDictionary<Guid, Substance> substances)
    {
        _logger.LogInformation("Product creation matched existing product {ProductId}", existing.Id);
        return new CreateProductResult(CatalogMapper.ToResponse(existing, substances), Created: false);
    }

    /// <summary>The products with exactly the substance set of each result (one query per distinct set; sets are few).</summary>
    private async Task<IReadOnlyList<Product>> LoadSiblingPoolAsync(IReadOnlyList<ProductMatch> matches, CancellationToken cancellationToken)
    {
        var sets = matches
            .Select(match => match.Product.SubstanceIds)
            .Where(set => set.Count > 0)
            .DistinctBy(set => string.Join('|', set.Order()))
            .ToArray();
        var pool = new List<Product>();
        foreach (var set in sets)
        {
            pool.AddRange(await _catalog.FindWithSameSubstancesAsync(set.ToArray(), SiblingCandidates, cancellationToken));
        }

        return pool;
    }

    private async Task<IReadOnlyDictionary<Guid, Substance>> LoadSubstancesAsync(CancellationToken cancellationToken) =>
        (await _catalog.ListSubstancesAsync(cancellationToken)).ToDictionary(substance => substance.Id);

    private static IReadOnlyList<ProductIngredient> Ingredients(CreateProductRequest request) =>
        (request.Substances ?? []).Select(substance => (ProductIngredient)substance).ToArray();

    private static IReadOnlyList<Guid> MergeTargetIds(IReadOnlyList<Product> candidates) =>
        candidates.Select(candidate => candidate.MergedIntoId).OfType<Guid>().Distinct().ToArray();
}
