using Lotties.Domain.Medications;

namespace Lotties.Domain.Imports;

/// <summary>An item whose normalized name is within typo tolerance of a looked-up name; <see cref="Order"/> is its position in the indexed sequence.</summary>
internal sealed record SimilarName<TItem>(TItem Item, string NormalizedName, int Distance, int Order);

/// <summary>
/// Items bucketed by the length of their normalized name. Two names within typo tolerance differ in length by at most
/// <see cref="MedicationNameMatcher.MaxTolerance"/>, so a lookup only compares against the few neighbouring buckets
/// (with the bounded edit distance) instead of every item. Results are the same as comparing against all items.
/// </summary>
internal sealed class SimilarNameIndex<TItem>
{
    private readonly IReadOnlyDictionary<int, IReadOnlyList<IndexedName>> _byLength;

    private SimilarNameIndex(IReadOnlyDictionary<int, IReadOnlyList<IndexedName>> byLength)
    {
        _byLength = byLength;
    }

    /// <param name="normalizedNameOf">The normalized name of an item, computed once per item.</param>
    public static SimilarNameIndex<TItem> Create(IEnumerable<TItem> items, Func<TItem, string> normalizedNameOf)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(normalizedNameOf);
        var byLength = items
            .Select((item, order) => new IndexedName(item, normalizedNameOf(item), order))
            .GroupBy(indexed => indexed.NormalizedName.Length)
            .ToDictionary(group => group.Key, group => (IReadOnlyList<IndexedName>)group.ToArray());
        return new SimilarNameIndex<TItem>(byLength);
    }

    /// <summary>Every item within tolerance of <paramref name="normalizedName"/>, in indexed order.</summary>
    public IReadOnlyList<SimilarName<TItem>> FindSimilar(string normalizedName)
    {
        ArgumentNullException.ThrowIfNull(normalizedName);
        return CandidateLengths(normalizedName.Length)
            .SelectMany(length => _byLength.GetValueOrDefault(length) ?? [])
            .Select(candidate => MatchOrNull(normalizedName, candidate))
            .OfType<SimilarName<TItem>>()
            .OrderBy(match => match.Order)
            .ToArray();
    }

    private static IEnumerable<int> CandidateLengths(int length) =>
        Enumerable.Range(length - MedicationNameMatcher.MaxTolerance, (2 * MedicationNameMatcher.MaxTolerance) + 1).Where(candidate => candidate >= 0);

    private static SimilarName<TItem>? MatchOrNull(string normalizedName, IndexedName candidate) =>
        MedicationNameMatcher.DistanceWithinTolerance(normalizedName, candidate.NormalizedName) is { } distance
            ? new SimilarName<TItem>(candidate.Item, candidate.NormalizedName, distance, candidate.Order)
            : null;

    private sealed record IndexedName(TItem Item, string NormalizedName, int Order);
}

/// <summary>
/// A baby's medication catalog with every name normalized once: lookups by id, by exact normalized name and by typo
/// distance (<see cref="SimilarNameIndex{TItem}"/>).
/// </summary>
internal sealed class MedicationCatalogIndex
{
    private readonly IReadOnlyDictionary<Guid, Medication> _byId;
    private readonly IReadOnlyDictionary<string, Medication> _byNormalizedName;
    private readonly SimilarNameIndex<NormalizedMedication> _similar;

    private MedicationCatalogIndex(IReadOnlyList<Medication> catalog)
    {
        var normalized = catalog.Select(medication => new NormalizedMedication(medication, MedicationNameMatcher.Normalize(medication.Name))).ToArray();
        _byId = catalog.DistinctBy(medication => medication.Id).ToDictionary(medication => medication.Id);
        _byNormalizedName = normalized
            .DistinctBy(entry => entry.NormalizedName, StringComparer.Ordinal)
            .ToDictionary(entry => entry.NormalizedName, entry => entry.Medication, StringComparer.Ordinal);
        _similar = SimilarNameIndex<NormalizedMedication>.Create(normalized, entry => entry.NormalizedName);
    }

    public static MedicationCatalogIndex Create(IReadOnlyList<Medication> catalog)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        return new MedicationCatalogIndex(catalog);
    }

    public Medication? FindById(Guid? medicationId) => medicationId is { } id ? _byId.GetValueOrDefault(id) : null;

    /// <summary>The first catalog entry (in catalog order) whose normalized name equals <paramref name="normalizedName"/>.</summary>
    public Medication? FindByNormalizedName(string normalizedName) => _byNormalizedName.GetValueOrDefault(normalizedName);

    /// <summary>The closest entry within tolerance: smallest distance, then name (case-insensitive), then catalog order.</summary>
    public MedicationMatch? FindBestMatch(string normalizedName) =>
        _similar.FindSimilar(normalizedName)
            .OrderBy(match => match.Distance)
            .ThenBy(match => match.Item.Medication.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(match => match.Order)
            .Select(match => new MedicationMatch(match.Item.Medication, match.Distance))
            .FirstOrDefault();

    private sealed record NormalizedMedication(Medication Medication, string NormalizedName);
}
