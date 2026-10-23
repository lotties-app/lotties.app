using System.Text.Json;
using System.Text.Json.Serialization;
using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;

namespace Lotties.Infrastructure.Catalog.Official;

/// <summary>
/// Reads the curated product list (<c>code/api/tools/Lotties.CatalogImporter/Data/curated-products.json</c>):
/// <c>{"products": [{"id", "name", "form", "ingredients": [], "reviewed", "basis"}]}</c>. A form that is not a catalog
/// form or a missing field is an <see cref="ArgumentException"/> (the file is a programming input).
/// </summary>
public static class CuratedProducts
{
    /// <summary>The file name next to the importer (<c>Data/curated-products.json</c>).</summary>
    public const string FileName = "curated-products.json";

    private static readonly JsonSerializerOptions Options = new() { PropertyNameCaseInsensitive = true };

    public static IReadOnlyList<CuratedProductEntry> Parse(string json)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(json);
        var file = JsonSerializer.Deserialize<ListFile>(json, Options) ?? throw new ArgumentException("The curated list is empty.", nameof(json));
        return file.Products.Select(entry => (CuratedProductEntry)entry).ToArray();
    }

    private sealed class ListFile
    {
        public string About { get; set; } = string.Empty;

        public List<Entry> Products { get; set; } = [];
    }

    private sealed class Entry
    {
        public string Id { get; set; } = string.Empty;

        public string Name { get; set; } = string.Empty;

        public string Form { get; set; } = string.Empty;

        public List<string> Ingredients { get; set; } = [];

        public bool? Reviewed { get; set; }

        public string Basis { get; set; } = string.Empty;

        public string? OfficialName { get; set; }

        public string? Registration { get; set; }

        public string? Route { get; set; }

        [JsonPropertyName("anvisaCheck")]
        public Check? Recorded { get; set; }

        public static explicit operator CuratedProductEntry(Entry entry) => new(
            entry.Id,
            entry.Name,
            Enum.TryParse<ProductForm>(entry.Form, ignoreCase: true, out var form) && Enum.IsDefined(form) && !int.TryParse(entry.Form, out _)
                ? form
                : throw new ArgumentException($"Curated product '{entry.Id}' has an unknown form '{entry.Form}'.", nameof(entry)),
            entry.Ingredients.ToArray(),
            entry.Reviewed ?? throw new ArgumentException($"Curated product '{entry.Id}' must say whether it was reviewed.", nameof(entry)),
            string.IsNullOrWhiteSpace(entry.Basis) ? throw new ArgumentException($"Curated product '{entry.Id}' needs its basis.", nameof(entry)) : entry.Basis,
            entry.OfficialName,
            entry.Registration,
            entry.Route,
            entry.Recorded is { } check ? new AnvisaCheck(check.Date, check.Status, check.Evidence.ToArray()) : null);
    }

    private sealed class Check
    {
        public string Date { get; set; } = string.Empty;

        public string Status { get; set; } = string.Empty;

        public List<string> Evidence { get; set; } = [];
    }
}
