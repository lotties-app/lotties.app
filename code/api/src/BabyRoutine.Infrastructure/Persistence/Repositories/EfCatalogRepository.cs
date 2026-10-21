using BabyRoutine.Domain.Catalog;
using BabyRoutine.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Candidate loads are plain prefix/length/LIKE predicates on <c>normalized_name</c> (no trigram extension), each capped
/// by the caller. Race safety of <see cref="TryAddProductAsync"/> relies on the partial unique index on (normalized
/// name, form, country): the loser's product and links are detached and <c>false</c> is returned. Id filters use
/// lists, not arrays: <c>array.Contains</c> may bind to the span overload, which EF Core cannot translate.
/// </remarks>
internal sealed class EfCatalogRepository(BabyRoutineDbContext context, UniqueViolations uniqueViolations, ILogger<EfCatalogRepository> logger) : ICatalogRepository
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
                .Where(product => product.MergedIntoId == null && product.Substances.Any(link => ids.Contains(link.SubstanceId)))
                .OrderBy(product => product.Name)
                .ThenBy(product => product.Id)
                .Take(take)
                .ToListAsync(cancellationToken);
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

    private IQueryable<Product> PrefixQuery(ProductCandidateFilter filter, int take) =>
        ProductsWithSubstances()
            .Where(product => product.NormalizedName.StartsWith(filter.Prefix))
            .OrderBy(product => product.NormalizedName)
            .ThenBy(product => product.Id)
            .Take(take);

    private IQueryable<Product> TypoBucketQuery(ProductCandidateFilter filter, int take) =>
        ProductsWithSubstances()
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
