using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Catalog;

/// <summary>
/// An active ingredient of the shared catalog, by generic name in English and Brazilian Portuguese (plus synonyms such
/// as <c>acetaminophen</c>). Substances are curated: they ship as migration seed data with cited sources and carry no
/// dosing information. There is no API to create them.
/// </summary>
public sealed class Substance
{
    public const int NameMaxLength = 100;
    public const int KeyMaxLength = Slug.MaxLength;
    public const int MaxSynonyms = 5;

    /// <summary>Separates synonyms in storage; a synonym never contains it.</summary>
    public const char SynonymSeparator = '|';

    private Substance()
    {
    }

    private Substance(Guid id, string key, string nameEn, string namePtBr, IReadOnlyList<string> synonyms, DateTimeOffset createdAt)
    {
        Id = id;
        Key = key;
        NameEn = nameEn;
        NamePtBr = namePtBr;
        Synonyms = synonyms;
        CreatedAt = createdAt;
    }

    public Guid Id { get; private set; }

    /// <summary>Stable lower snake_case key, e.g. <c>simethicone</c>.</summary>
    public string Key { get; private set; } = string.Empty;

    public string NameEn { get; private set; } = string.Empty;

    public string NamePtBr { get; private set; } = string.Empty;

    /// <summary>Other generic names (e.g. <c>acetaminophen</c> for paracetamol), matched by search; never empty strings.</summary>
    public IReadOnlyList<string> Synonyms { get; private set; } = [];

    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>Every name search compares against: the key (underscores as spaces), both names and the synonyms.</summary>
    public IReadOnlyList<string> SearchNames => [Key.Replace('_', ' '), NameEn, NamePtBr, .. Synonyms];

    /// <summary>A curated substance for seed data.</summary>
    public static Substance Seed(Guid id, string key, string nameEn, string namePtBr, IReadOnlyList<string> synonyms, DateTimeOffset createdAt)
    {
        ArgumentNullException.ThrowIfNull(synonyms);
        if (!Slug.IsValid(key))
        {
            throw new DomainValidationException(nameof(Key), "Substance key must be lower snake_case.");
        }

        if (synonyms.Count > MaxSynonyms || synonyms.Any(synonym => synonym.Contains(SynonymSeparator, StringComparison.Ordinal)))
        {
            throw new DomainValidationException(nameof(Synonyms), $"A substance has at most {MaxSynonyms} synonyms, none containing '{SynonymSeparator}'.");
        }

        return new Substance(
            Ids.Required(id, nameof(id)),
            key,
            Text.Required(nameEn, nameof(NameEn), NameMaxLength),
            Text.Required(namePtBr, nameof(NamePtBr), NameMaxLength),
            synonyms.Select(synonym => Text.Required(synonym, nameof(Synonyms), NameMaxLength)).ToArray(),
            UtcTime.Normalize(createdAt));
    }
}
