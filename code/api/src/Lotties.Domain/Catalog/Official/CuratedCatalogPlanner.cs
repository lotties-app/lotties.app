using System.Text.RegularExpressions;

namespace Lotties.Domain.Catalog.Official;

/// <summary>
/// One entry of the curated product list (the importer's <c>Data/curated-products.json</c>): a common product that is
/// missing or ambiguous in the official data, with its form and ingredients (spellings of the curated substance map),
/// whether a pharmacist or pediatrician reviewed it, and the basis it rests on (owner statement, manufacturer page,
/// price list...). <see cref="Id"/> is its stable key (lower-case letters, digits and dashes). The optional fields only
/// steer the verifier: <see cref="OfficialName"/> (the exact official name to look up when it differs from the display
/// name), <see cref="Registration"/> (nine-digit ANVISA registration to look up instead of the name), <see cref="Route"/>
/// (<c>oral</c>, <c>nasal</c>, <c>topical</c>...) and the last recorded <see cref="AnvisaCheck"/>.
/// <see cref="Strength"/> (the concentration exactly as printed on the label, e.g. <c>9 mg/mL (0,9%)</c>; composition,
/// never a dose) and <see cref="PackageSize"/> (e.g. <c>100 mL</c>) become the product's presentation text.
/// <see cref="Category"/> is <c>medicine</c>, <c>homeopathic</c> or <c>supplement</c> (what the label says it is; the
/// verifier refuses to let two categories share an ingredient set). <see cref="AliasOf"/> marks an entry that is not a
/// product but another name people use for the entry with that id: it is imported as an alias (a merged product), so
/// searching the old name finds the real one. <see cref="Strengths"/> is the optional structured form of the strength
/// (one item per ingredient, all of them or none): it becomes the product's <see cref="CatalogProductPlan.StrengthKey"/>
/// that the alternatives rule compares; only enter it where the label or the <see cref="Basis"/> states the amount.
/// </summary>
public sealed record CuratedProductEntry(
    string Id,
    string Name,
    ProductForm Form,
    IReadOnlyList<string> Ingredients,
    bool Reviewed,
    string Basis,
    string? OfficialName = null,
    string? Registration = null,
    string? Route = null,
    AnvisaCheck? AnvisaCheck = null,
    string? Strength = null,
    string? PackageSize = null,
    string? Category = null,
    string? AliasOf = null,
    IReadOnlyList<CuratedStrength>? Strengths = null);

/// <summary>
/// The structured strength of one ingredient of a curated entry, as the label states it: <see cref="Ingredient"/> (a
/// spelling of the curated substance map, one of the entry's ingredients) with either an <see cref="Amount"/> and a
/// <see cref="Unit"/> (<c>9</c> + <c>mg/mL</c>, <c>0,25</c> + <c>mL/mL</c>; units as in <see cref="StrengthParser"/>) or a
/// probiotic <see cref="Strain"/> (<c>DSM 17938</c>). Composition, never a dose.
/// </summary>
public sealed record CuratedStrength(string Ingredient, string? Amount = null, string? Unit = null, string? Strain = null);

/// <summary>
/// The recorded result of the machine cross-check of an entry against ANVISA's open data (<c>verify-curated</c>): the
/// date, the status (<c>VERIFIED</c>, <c>MISMATCH</c>, <c>NOT_FOUND</c>, <c>AMBIGUOUS</c>, <c>CANCELLED</c>,
/// <c>UNVERIFIABLE</c>) and the registration numbers or product names it rests on. It is not a pharmacist's review
/// (<see cref="CuratedProductEntry.Reviewed"/>) and says nothing about age, dose or equivalence for treatment.
/// </summary>
public sealed record AnvisaCheck(string Date, string Status, IReadOnlyList<string> Evidence);

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

    /// <summary>The values of <see cref="CuratedProductEntry.Category"/>.</summary>
    public static readonly IReadOnlyList<string> Categories = ["medicine", "homeopathic", "supplement"];

    public static CuratedCatalogPlan Plan(IReadOnlyList<CuratedProductEntry> entries, SubstanceDictionary dictionary)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(dictionary);
        EnsureUnique(entries);
        EnsureValidMetadata(entries);
        var resolved = entries.Select(entry => (entry, ingredients: Ingredients(entry, dictionary))).ToArray();
        var products = resolved.Select(item => ToPlan(item.entry, item.ingredients, dictionary)).ToArray();
        var substances = resolved
            .SelectMany(item => item.ingredients)
            .DistinctBy(substance => substance.Key, StringComparer.Ordinal)
            .OrderBy(substance => substance.Key, StringComparer.Ordinal)
            .ToArray();
        return new CuratedCatalogPlan(products, substances);
    }

    private static CatalogProductPlan ToPlan(CuratedProductEntry entry, IReadOnlyList<SubstanceDefinition> ingredients, SubstanceDictionary dictionary)
    {
        var name = ProductNames.Sanitize(entry.Name, "name", Product.NameMaxLength);
        var strength = StrengthOf(entry, ingredients, dictionary);
        return new CatalogProductPlan(
            CuratedSource,
            ProductStatus.Curated,
            entry.Id,
            name,
            ProductNames.Key(name),
            entry.Form,
            PresentationOf(entry) is { } presentation ? ProductNames.Sanitize(presentation, "presentation", Product.PresentationMaxLength) : null,
            ingredients.Select(ingredient => ingredient.Key).ToArray(),
            [],
            null,
            entry.AliasOf,
            strength?.Key,
            strength?.Text);
    }

    /// <summary>
    /// The canonical key and the display text of the entry's structured strengths, or <c>null</c> when it has none.
    /// Every ingredient needs exactly one item (an amount with a known unit, or a strain), else the list is broken and
    /// <see cref="ArgumentException"/> is thrown: a half-structured strength would compare wrongly.
    /// </summary>
    private static (string Key, string Text)? StrengthOf(CuratedProductEntry entry, IReadOnlyList<SubstanceDefinition> ingredients, SubstanceDictionary dictionary)
    {
        if (entry.Strengths is not { Count: > 0 } strengths)
        {
            return null;
        }

        var tokens = strengths.Select(strength => StrengthToken(entry, strength, dictionary)).ToArray();
        var covered = tokens.Select(token => token.SubstanceKey).Order(StringComparer.Ordinal).ToArray();
        if (!covered.SequenceEqual(ingredients.Select(ingredient => ingredient.Key).Order(StringComparer.Ordinal), StringComparer.Ordinal))
        {
            throw new ArgumentException($"Curated product '{entry.Id}' must give a structured strength for each of its ingredients, once.", nameof(entry));
        }

        var text = string.IsNullOrWhiteSpace(entry.Strength) ? string.Join("; ", tokens.Select(token => token.Display)) : entry.Strength.Trim();
        return (StrengthKeys.Of(tokens.Select(token => token.Token)), ProductNames.Sanitize(text, "strength", Product.StrengthTextMaxLength));
    }

    private static (string SubstanceKey, string Token, string Display) StrengthToken(CuratedProductEntry entry, CuratedStrength strength, SubstanceDictionary dictionary)
    {
        var key = dictionary.Resolve(strength.Ingredient).Key;
        if (!string.IsNullOrWhiteSpace(strength.Strain))
        {
            return (key, StrengthKeys.StrainToken(key, strength.Strain), strength.Strain.Trim());
        }

        var reading = StrengthParser.Read($"{strength.Amount?.Trim()} {strength.Unit?.Trim()} ");
        return reading.Amount is { } amount
            ? (key, StrengthKeys.Single(key, amount), reading.Display!)
            : throw new ArgumentException($"Curated product '{entry.Id}' has a strength that is not understood ('{strength.Amount} {strength.Unit}').", nameof(entry));
    }

    /// <summary>The presentation text of an entry: strength as printed, then package size; <c>null</c> when it has neither.</summary>
    public static string? PresentationOf(CuratedProductEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        var parts = new[] { entry.Strength, entry.PackageSize }.Where(part => !string.IsNullOrWhiteSpace(part)).Select(part => part!.Trim()).ToArray();
        return parts.Length == 0 ? null : string.Join("; ", parts);
    }

    private static IReadOnlyList<SubstanceDefinition> Ingredients(CuratedProductEntry entry, SubstanceDictionary dictionary)
    {
        var ingredients = (entry.Ingredients ?? []).Where(name => !string.IsNullOrWhiteSpace(name)).Select(dictionary.Resolve).DistinctBy(substance => substance.Key, StringComparer.Ordinal).ToArray();
        return ingredients.Length > 0 && ingredients.Length <= Product.OfficialMaxSubstances
            ? ingredients
            : throw new ArgumentException($"Curated product '{entry.Id}' needs between 1 and {Product.OfficialMaxSubstances} ingredients.", nameof(entry));
    }

    private static void EnsureValidMetadata(IReadOnlyList<CuratedProductEntry> entries)
    {
        var badCategory = entries.FirstOrDefault(entry => entry.Category is not null && !Categories.Contains(entry.Category, StringComparer.Ordinal));
        var badAlias = entries.FirstOrDefault(entry => entry.AliasOf is not null
            && (entry.AliasOf == entry.Id || entries.FirstOrDefault(target => target.Id == entry.AliasOf) is not { AliasOf: null }));
        var tooLong = entries.FirstOrDefault(entry => (PresentationOf(entry)?.Length ?? 0) > Product.PresentationMaxLength);
        if (badCategory is not null || badAlias is not null || tooLong is not null)
        {
            throw new ArgumentException(
                $"Curated products need a known category (medicine, homeopathic, supplement), an alias that points to another entry which is not an alias itself, and a presentation of at most {Product.PresentationMaxLength} characters (category '{badCategory?.Id}', alias '{badAlias?.Id}', presentation '{tooLong?.Id}').",
                nameof(entries));
        }
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
