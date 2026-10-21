using Lotties.Domain.Catalog;

namespace Lotties.Application.Catalog;

/// <summary>Maps catalog products to responses; substance names come from the curated list.</summary>
internal static class CatalogMapper
{
    public static ProductResponse ToResponse(Product product, IReadOnlyDictionary<Guid, Substance> substances) => new()
    {
        Id = product.Id,
        Name = product.Name,
        Form = product.Form,
        Country = product.Country.Value,
        Status = product.Status,
        MergedIntoId = product.MergedIntoId,
        Substances = product.Substances.Select(link => ToResponse(link, substances)).OrderBy(link => link.NameEn, StringComparer.OrdinalIgnoreCase).ToArray(),
        CreatedAt = product.CreatedAt,
    };

    public static ProductSearchResult ToSearchResult(ProductMatch match, IReadOnlyList<Product> siblings, IReadOnlyDictionary<Guid, Substance> substances) => new()
    {
        Product = ToResponse(match.Product, substances),
        MatchedBy = match.MatchedBy,
        Distance = match.Distance,
        SameActiveIngredient = siblings.Select(sibling => (ProductSummary)sibling).ToArray(),
    };

    private static ProductSubstanceResponse ToResponse(ProductSubstance link, IReadOnlyDictionary<Guid, Substance> substances)
    {
        var substance = substances.GetValueOrDefault(link.SubstanceId);
        return new ProductSubstanceResponse
        {
            SubstanceId = link.SubstanceId,
            Key = substance?.Key ?? string.Empty,
            NameEn = substance?.NameEn ?? string.Empty,
            NamePtBr = substance?.NamePtBr ?? string.Empty,
            Strength = link.Strength is null ? null : (SubstanceStrengthDto)link.Strength,
        };
    }
}
