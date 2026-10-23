using Lotties.Domain.Catalog;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Candidate loads are plain prefix/length/LIKE predicates on <c>normalized_name</c> (no trigram extension), each capped
/// by the caller. Race safety of <see cref="TryAddProductAsync"/> relies on the partial unique index on (normalized
/// name, form, country): the loser's product and links are detached and <c>false</c> is returned. Id filters use
/// lists, not arrays: <c>array.Contains</c> may bind to the span overload, which EF Core cannot translate.
/// </remarks>
internal sealed class EfCatalogRepository(LottiesDbContext context, UniqueViolations uniqueViolations, ILogger<EfCatalogRepository> logger) : ICatalogRepository
{
    public async Task<IReadOnlyList<Substance>> ListSubstancesAsync(CancellationToken cancellationToken = default) =>
        await context.Substances.AsNoTracking().OrderBy(substance => substance.NameEn).ThenBy(substance => substance.Id).ToListAsync(cancellationToken);

    public Task<Product?> FindProductAsync(Guid productId, CancellationToken cancellationToken = default) =>
        ProductsWithSubstances().SingleOrDefaultAsync(product => product.Id == productId, cancellationToken);

    public async Task<IReadOnlyList<Product>> FindProductsAsync(IReadOnlyCollection<Guid> productIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(productIds);
        var ids = productIds.Distinct().ToList();
        return ids.Count == 0 ? [] : await ProductsWithSubstances().Where(product => ids.Contains(product.Id)).ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Product>> FindNameCandidatesAsync(ProductCandidateFilter filter, int take, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(filter);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(take);
        var byPrefix = await PrefixQuery(filter, take).ToListAsync(cancellationToken);
        var byTypo = await TypoBucketQuery(filter, take).ToListAsync(cancellationToken);
        return byPrefix.Concat(byTypo).DistinctBy(product => product.Id).ToArray();
    }

    public async Task<IReadOnlyList<Product>> FindBySubstancesAsync(IReadOnlyCollection<Guid> substanceIds, int take, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(substanceIds);
        var ids = substanceIds.Distinct().ToList();
        return ids.Count == 0
            ? []
            : await ProductsWithSubstances()
                .Where(product => product.MergedIntoId == null && product.InactiveSince == null && product.Substances.Any(link => ids.Contains(link.SubstanceId)))
                .OrderBy(product => product.Name)
                .ThenBy(product => product.Id)
                .Take(take)
                .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Product>> FindWithSameSubstancesAsync(IReadOnlyCollection<Guid> substanceIds, int take, AlternativePreference? prefer = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(substanceIds);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(take);
        var ids = substanceIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        var first = ids[0];
        var count = ids.Count;
        var same = ProductsWithSubstances()
            .Where(product => product.MergedIntoId == null
                && product.InactiveSince == null
                && product.Substances.Any(link => link.SubstanceId == first)
                && product.Substances.Count == count
                && product.Substances.All(link => ids.Contains(link.SubstanceId)));
        return await PreferStrength(same, prefer).Take(take).ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Product>> FindAmbiguousVariantsAsync(IReadOnlyCollection<string> ambiguousNames, int take, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(ambiguousNames);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(take);
        var names = ambiguousNames.Distinct(StringComparer.Ordinal).ToList();
        return names.Count == 0
            ? []
            : await OfficialFirst(ProductsWithSubstances()
                    .Where(product => product.MergedIntoId == null && product.InactiveSince == null && product.AmbiguousName != null && names.Contains(product.AmbiguousName)))
                .Take(take)
                .ToListAsync(cancellationToken);
    }

    public async Task<ProductPage> ListContainingSubstanceAsync(Guid substanceId, CatalogPage page, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(page);
        var containing = context.Products.AsNoTracking()
            .Where(product => product.MergedIntoId == null && product.InactiveSince == null && product.Substances.Any(link => link.SubstanceId == substanceId));
        var total = await containing.CountAsync(cancellationToken);
        var items = await OfficialFirst(containing.Include(product => product.Substances))
            .Skip(page.Offset)
            .Take(page.Limit)
            .ToListAsync(cancellationToken);
        return new ProductPage(items, total);
    }

    public Task<Product?> FindDuplicateAsync(string normalizedName, ProductForm form, CountryCode country, CancellationToken cancellationToken = default) =>
        ProductsWithSubstances().FirstOrDefaultAsync(
            product => product.MergedIntoId == null && product.NormalizedName == normalizedName && product.Form == form && product.Country == country,
            cancellationToken);

    public async Task<bool> TryAddProductAsync(Product product, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(product);
        try
        {
            context.Products.Add(product);
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            Detach(product);
            return false;
        }
        catch (DbUpdateException exception)
        {
            Detach(product);
            logger.LogError(exception, "Saving new product {ProductId} failed with a database error that is not a unique violation", product.Id);
            throw;
        }
    }

    private IQueryable<Product> ProductsWithSubstances() => context.Products.AsNoTracking().Include(product => product.Substances);

    /// <summary>Products with the preferred strength key (and form) first, then <see cref="OfficialFirst"/>.</summary>
    private static IOrderedQueryable<Product> PreferStrength(IQueryable<Product> products, AlternativePreference? prefer)
    {
        var key = prefer?.StrengthKey;
        var form = prefer?.Form ?? ProductForm.Other;
        var knownForm = prefer is not null && form != ProductForm.Other;
        return products
            .OrderBy(product => key != null && product.StrengthKey == key ? (knownForm && product.Form == form ? 0 : 1) : 2)
            .ThenBy(product => product.Status == ProductStatus.Official ? 0 : product.Status == ProductStatus.Curated ? 1 : 2)
            .ThenBy(product => product.Name)
            .ThenBy(product => product.Id);
    }

    private static IOrderedQueryable<Product> OfficialFirst(IQueryable<Product> products) =>
        products
            .OrderBy(product => product.Status == ProductStatus.Official ? 0 : product.Status == ProductStatus.Curated ? 1 : 2)
            .ThenBy(product => product.Name)
            .ThenBy(product => product.Id);

    private IQueryable<Product> PrefixQuery(ProductCandidateFilter filter, int take) =>
        ProductsWithSubstances()
            .Where(product => product.InactiveSince == null)
            .Where(product => product.NormalizedName.StartsWith(filter.Prefix))
            .OrderBy(product => product.NormalizedName)
            .ThenBy(product => product.Id)
            .Take(take);

    private IQueryable<Product> TypoBucketQuery(ProductCandidateFilter filter, int take) =>
        ProductsWithSubstances()
            .Where(product => product.InactiveSince == null)
            .Where(product => product.NormalizedName.Length >= filter.MinLength
                && product.NormalizedName.Length <= filter.MaxLength
                && (product.NormalizedName.StartsWith(filter.FirstCharacter) || product.NormalizedName.EndsWith(filter.LastCharacter)))
            .OrderBy(product => product.NormalizedName)
            .ThenBy(product => product.Id)
            .Take(take);

    private void Detach(Product product)
    {
        context.Entry(product).State = EntityState.Detached;
        product.Substances.ToList().ForEach(link => context.Entry(link).State = EntityState.Detached);
    }
}
