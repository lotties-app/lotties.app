using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Catalog;

/// <summary>
/// The rows of a bounded candidate load for <see cref="ProductSearch"/>: names whose key starts with
/// <see cref="Prefix"/> (search as you type), plus names whose key length is within <see cref="MinLength"/>-<see cref="MaxLength"/>
/// and that share the first or the last character with the query (typo bucket). Plain prefix/length/LIKE filters, so
/// any provider (PostgreSQL, SQLite) can serve it without trigram extensions.
/// </summary>
public sealed record ProductCandidateFilter(string Prefix, string FirstCharacter, string LastCharacter, int MinLength, int MaxLength);

/// <summary>A catalog search text reduced to its <see cref="ProductNames.Key"/>.</summary>
public sealed record CatalogQuery
{
    public const int MaxLength = 100;
    public const string Field = "q";

    private CatalogQuery(string key)
    {
        Key = key;
    }

    public string Key { get; }

    public ProductCandidateFilter CandidateFilter => new(
        Key,
        Key[..1],
        Key[^1..],
        Math.Max(ProductNames.MinKeyLength, Key.Length - Imports.MedicationNameMatcher.MaxTolerance),
        Key.Length + Imports.MedicationNameMatcher.MaxTolerance);

    /// <summary>Throws <see cref="DomainValidationException"/> (field <c>q</c>) when the text is longer than <see cref="MaxLength"/> or has fewer than two letters/digits.</summary>
    public static CatalogQuery From(string? text)
    {
        if (text is null || text.Length > MaxLength)
        {
            throw new DomainValidationException(Field, $"q is required and at most {MaxLength} characters.");
        }

        var key = ProductNames.Key(text);
        return key.Length >= ProductNames.MinKeyLength
            ? new CatalogQuery(key)
            : throw new DomainValidationException(Field, $"q must contain at least {ProductNames.MinKeyLength} letters or digits.");
    }
}
