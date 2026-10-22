using System.Text;
using System.Text.RegularExpressions;
using Lotties.Domain.Imports;

namespace Lotties.Domain.Catalog.Official;

/// <summary>
/// A curated substance: the stable key (lower snake_case, the existing seed key when there is one), the generic names in
/// English and Brazilian Portuguese, the active-ingredient spellings an official source uses for it (salts and hydrates
/// of the same active moiety included, e.g. <c>dipirona monoidratada</c>) and extra search synonyms.
/// </summary>
public sealed record CuratedSubstance(string Key, string NameEn, string NamePtBr, IReadOnlyList<string> SourceNames, IReadOnlyList<string> Synonyms);

/// <summary>The substance an ingredient name resolves to: curated, or derived from the source name itself.</summary>
public sealed record SubstanceDefinition(string Key, string NameEn, string NamePtBr, IReadOnlyList<string> Synonyms, bool Curated);

/// <summary>
/// Resolves the active-ingredient names of an official source to substances. Names are compared normalized (lower
/// case, no diacritics, single spaces). A name in the curated map gets its curated key and names (e.g.
/// <c>simeticona</c> -> <c>simethicone</c>); any other name becomes its own substance: key = ASCII slug of the name,
/// both names = the source name in title case (no translation is invented).
/// </summary>
public sealed class SubstanceDictionary
{
    private readonly IReadOnlyDictionary<string, CuratedSubstance> _bySourceName;

    private SubstanceDictionary(IReadOnlyDictionary<string, CuratedSubstance> bySourceName)
    {
        _bySourceName = bySourceName;
    }

    public static SubstanceDictionary Empty { get; } = new(new Dictionary<string, CuratedSubstance>());

    /// <summary>
    /// Builds the dictionary; throws <see cref="ArgumentException"/> when a key is not a valid substance key or is used
    /// twice, or a source name belongs to two entries (the curated map file is a programming input).
    /// </summary>
    public static SubstanceDictionary Create(IReadOnlyList<CuratedSubstance> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);
        EnsureUniqueKeys(entries);
        var bySourceName = new Dictionary<string, CuratedSubstance>(StringComparer.Ordinal);
        foreach (var (name, entry) in entries.SelectMany(entry => entry.SourceNames.Select(name => (ActiveIngredientNames.Normalize(name), entry))))
        {
            AddSourceName(bySourceName, name, entry);
        }

        return new SubstanceDictionary(bySourceName);
    }

    /// <summary>The substance for one cleaned ingredient name (see <see cref="ActiveIngredientNames.Split"/>).</summary>
    public SubstanceDefinition Resolve(string ingredientName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(ingredientName);
        var normalized = ActiveIngredientNames.Normalize(ingredientName);
        return _bySourceName.TryGetValue(normalized, out var curated)
            ? new SubstanceDefinition(curated.Key, curated.NameEn, curated.NamePtBr, curated.Synonyms, Curated: true)
            : Derived(ingredientName, normalized);
    }

    private static SubstanceDefinition Derived(string ingredientName, string normalized)
    {
        var name = Truncate(OfficialNames.TitleCase(ingredientName), Substance.NameMaxLength);
        return new SubstanceDefinition(SubstanceKeys.FromName(normalized), name, name, [], Curated: false);
    }

    private static string Truncate(string value, int maxLength) => value.Length <= maxLength ? value : value[..maxLength].TrimEnd();

    private static void EnsureUniqueKeys(IReadOnlyList<CuratedSubstance> entries)
    {
        var duplicate = entries.GroupBy(entry => entry.Key, StringComparer.Ordinal).FirstOrDefault(group => group.Count() > 1);
        var invalid = entries.FirstOrDefault(entry => !SubstanceKeys.IsValid(entry.Key));
        if (duplicate is not null || invalid is not null)
        {
            throw new ArgumentException($"Curated substance keys must be valid and unique (duplicate '{duplicate?.Key}', invalid '{invalid?.Key}').", nameof(entries));
        }
    }

    private static void AddSourceName(Dictionary<string, CuratedSubstance> bySourceName, string name, CuratedSubstance entry)
    {
        if (!bySourceName.TryAdd(name, entry) && bySourceName[name].Key != entry.Key)
        {
            throw new ArgumentException($"Source name '{name}' is mapped to both '{bySourceName[name].Key}' and '{entry.Key}'.", nameof(entry));
        }
    }
}

/// <summary>Substance keys: lower snake_case ASCII, at most <see cref="Substance.KeyMaxLength"/> characters, starting with a letter.</summary>
public static partial class SubstanceKeys
{
    private const int HashLength = 8;

    public static bool IsValid(string? key) => key is { Length: > 0 and <= Substance.KeyMaxLength } && Pattern().IsMatch(key);

    /// <summary>
    /// The key of a normalized name: non-alphanumerics become <c>_</c>, a leading digit gets an <c>s_</c> prefix, and a
    /// key longer than the limit keeps its start plus a stable 8-hex hash of the whole slug (so long names stay distinct).
    /// </summary>
    public static string FromName(string normalizedName)
    {
        ArgumentNullException.ThrowIfNull(normalizedName);
        var slug = NonAlphanumeric().Replace(normalizedName.ToLowerInvariant(), "_").Trim('_');
        var prefixed = slug.Length > 0 && char.IsAsciiLetter(slug[0]) ? slug : $"s_{slug}";
        return prefixed.Length <= Substance.KeyMaxLength ? prefixed : Shortened(prefixed);
    }

    private static string Shortened(string slug)
    {
        var start = slug[..(Substance.KeyMaxLength - HashLength - 1)].TrimEnd('_');
        return $"{start}_{Fnv1a(slug):x8}";
    }

    private static uint Fnv1a(string value)
    {
        const uint offsetBasis = 2166136261;
        const uint prime = 16777619;
        return Encoding.UTF8.GetBytes(value).Aggregate(offsetBasis, (hash, octet) => unchecked((hash ^ octet) * prime));
    }

    [GeneratedRegex(@"^[a-z][a-z0-9_]*\z", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();

    [GeneratedRegex("[^a-z0-9]+", RegexOptions.CultureInvariant)]
    private static partial Regex NonAlphanumeric();
}

/// <summary>
/// The active-ingredient field of an official record: names separated by commas (e.g. <c>dipirona monoidratada,
/// cafeína anidra</c>), some with a regulatory note (<c>carbidopa (port. 344/98 lista c 1)</c>) that is dropped.
/// </summary>
public static partial class ActiveIngredientNames
{
    /// <summary>The cleaned, distinct (by normalized form) ingredient names of the field, in source order.</summary>
    public static IReadOnlyList<string> Split(string? field) =>
        (field ?? string.Empty)
            .Split(',')
            .Select(Clean)
            .Where(name => name.Length > 0)
            .DistinctBy(Normalize, StringComparer.Ordinal)
            .ToArray();

    /// <summary>Lower case, no diacritics, single spaces.</summary>
    public static string Normalize(string name) => MedicationNameMatcher.Normalize(name ?? string.Empty);

    private static string Clean(string name)
    {
        var withoutNote = RegulatoryNote().Replace(name, " ");
        return Whitespace().Replace(withoutNote, " ").Trim(' ', '.', ';', '-');
    }

    [GeneratedRegex(@"\(?\s*port\.?\s*344\s*/\s*98.*$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex RegulatoryNote();

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex Whitespace();
}
