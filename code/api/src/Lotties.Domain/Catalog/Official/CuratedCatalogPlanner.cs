using System.Text.RegularExpressions;

namespace Lotties.Domain.Catalog.Official;

/// <summary>
/// One entry of the curated product list (the importer's <c>Data/curated-products.json</c>): a common product that is
/// missing or ambiguous in the official data, with its form and ingredients (spellings of the curated substance map),
/// whether a pharmacist or pediatrician reviewed it, and the basis it rests on (owner statement, manufacturer page,
/// price list...). <see cref="Id"/> is its stable key (lower-case letters, digits and dashes).
/// </summary>
public sealed record CuratedProductEntry(string Id, string Name, ProductForm Form, IReadOnlyList<string> Ingredients, bool Reviewed, string Basis);

/// <summary>The curated products to import and the substances they need.</summary>
public sealed record CuratedCatalogPlan(IReadOnlyList<CatalogProductPlan> Products, IReadOnlyList<SubstanceDefinition> Substances);

/// <summary>
/// Plans the curated list: status <see cref="ProductStatus.Curated"/>, source <c>curated</c>, external ref = the entry
/// id. Every entry needs a name, a form and at least one ingredient; ids and (name, form) pairs are unique. The list is
/// a programming input: a broken entry throws <see cref="ArgumentException"/> instead of being skipped.
/// </summary>
public static partial class CuratedCatalogPlanner
{
    public const string CuratedSource = "curated";

    public static CuratedCatalogPlan Plan(IReadOnlyList<CuratedProductEntry> entries, SubstanceDictionary dictionary)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(dictionary);
        EnsureUnique(entries);
        var resolved = entries.Select(entry => (entry, ingredients: Ingredients(entry, dictionary))).ToArray();
        var products = resolved.Select(item => ToPlan(item.entry, item.ingredients)).ToArray();
        var substances = resolved
            .SelectMany(item => item.ingredients)
            .DistinctBy(substance => substance.Key, StringComparer.Ordinal)
            .OrderBy(substance => substance.Key, StringComparer.Ordinal)
            .ToArray();
        return new CuratedCatalogPlan(products, substances);
    }

    private static CatalogProductPlan ToPlan(CuratedProductEntry entry, IReadOnlyList<SubstanceDefinition> ingredients)
    {
        var name = ProductNames.Sanitize(entry.Name, "name", Product.NameMaxLength);
        return new CatalogProductPlan(
            CuratedSource,
            ProductStatus.Curated,
            entry.Id,
            name,
            ProductNames.Key(name),
            entry.Form,
            null,
            ingredients.Select(ingredient => ingredient.Key).ToArray(),
            [],
            null);
    }

    private static IReadOnlyList<SubstanceDefinition> Ingredients(CuratedProductEntry entry, SubstanceDictionary dictionary)
    {
        var ingredients = (entry.Ingredients ?? []).Where(name => !string.IsNullOrWhiteSpace(name)).Select(dictionary.Resolve).DistinctBy(substance => substance.Key, StringComparer.Ordinal).ToArray();
        return ingredients.Length > 0 && ingredients.Length <= Product.OfficialMaxSubstances
            ? ingredients
            : throw new ArgumentException($"Curated product '{entry.Id}' needs between 1 and {Product.OfficialMaxSubstances} ingredients.", nameof(entry));
    }

    private static void EnsureUnique(IReadOnlyList<CuratedProductEntry> entries)
    {
        var invalidId = entries.FirstOrDefault(entry => entry.Id is null || !IdPattern().IsMatch(entry.Id));
        var duplicateId = entries.GroupBy(entry => entry.Id, StringComparer.Ordinal).FirstOrDefault(group => group.Count() > 1);
        var duplicateKey = entries.GroupBy(entry => (ProductNames.Key(entry.Name ?? string.Empty), entry.Form)).FirstOrDefault(group => group.Count() > 1);
        var unknownForm = entries.FirstOrDefault(entry => !Enum.IsDefined(entry.Form));
        if (invalidId is not null || duplicateId is not null || duplicateKey is not null || unknownForm is not null)
        {
            throw new ArgumentException(
                $"Curated products need valid unique ids, known forms and unique (name, form) pairs (invalid id '{invalidId?.Id}', duplicate id '{duplicateId?.Key}', duplicate name '{duplicateKey?.Key.Item1}', unknown form '{unknownForm?.Id}').",
                nameof(entries));
        }
    }

    [GeneratedRegex(@"^[a-z0-9][a-z0-9-]{1,99}\z", RegexOptions.CultureInvariant)]
    private static partial Regex IdPattern();
}
