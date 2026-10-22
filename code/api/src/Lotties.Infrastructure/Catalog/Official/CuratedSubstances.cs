using System.Text.Json;
using Lotties.Domain.Catalog.Official;

namespace Lotties.Infrastructure.Catalog.Official;

/// <summary>
/// The curated substance map of the official-list importer, embedded from <c>curated-substances.json</c> (one data file:
/// pt-BR source spellings to the catalog key, English and Portuguese generic names and synonyms).
/// </summary>
public static class CuratedSubstances
{
    public const string ResourceName = "Lotties.Infrastructure.Catalog.Official.curated-substances.json";

    private static readonly JsonSerializerOptions Options = new() { PropertyNameCaseInsensitive = true };

    /// <summary>The entries of the embedded map.</summary>
    public static IReadOnlyList<CuratedSubstance> Load()
    {
        using var stream = typeof(CuratedSubstances).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Embedded resource {ResourceName} is missing.");
        var file = JsonSerializer.Deserialize<MapFile>(stream, Options) ?? throw new InvalidOperationException($"{ResourceName} is empty.");
        return file.Substances.Select(entry => (CuratedSubstance)entry).ToArray();
    }

    /// <summary>The dictionary built from the embedded map.</summary>
    public static SubstanceDictionary Dictionary() => SubstanceDictionary.Create(Load());

    private sealed class MapFile
    {
        public string About { get; set; } = string.Empty;

        public List<MapEntry> Substances { get; set; } = [];
    }

    private sealed class MapEntry
    {
        public string Key { get; set; } = string.Empty;

        public string NameEn { get; set; } = string.Empty;

        public string NamePtBr { get; set; } = string.Empty;

        public List<string> SourceNames { get; set; } = [];

        public List<string> Synonyms { get; set; } = [];

        public static explicit operator CuratedSubstance(MapEntry entry) =>
            new(entry.Key, entry.NameEn, entry.NamePtBr, entry.SourceNames.ToArray(), entry.Synonyms.ToArray());
    }
}
