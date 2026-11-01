using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Medications;

namespace BabyRoutine.Domain.Imports;

/// <summary>What the user decided for one medication name found in the import.</summary>
public enum MedicationMappingAction
{
    /// <summary>Use the catalog medication <see cref="MedicationMapping.MedicationId"/>.</summary>
    Existing,

    /// <summary>Use a catalog medication named <see cref="MedicationMapping.Name"/>, creating it when the catalog has none.</summary>
    Create,

    /// <summary>Leave the name out of the imported events.</summary>
    Ignore,
}

/// <summary>The mapping of one original token (matched case- and diacritics-insensitively).</summary>
public sealed record MedicationMapping(string Token, MedicationMappingAction Action, Guid? MedicationId, string? Name);

/// <summary>A medication referenced by an imported medication event (a copy of its name is kept in the payload).</summary>
public sealed record ImportedMedication(Guid MedicationId, string Name);

/// <summary>The medications a row's tokens resolve to, and the tokens that have no mapping.</summary>
public sealed record MedicationTokenResolution(IReadOnlyList<ImportedMedication> Medications, IReadOnlyList<string> Unmapped);

/// <summary>
/// Resolves medication tokens through the user's mappings. Mappings are validated up front: an <c>existing</c> target
/// must be in the baby's catalog, a <c>create</c> needs a valid name, and one token cannot be mapped twice
/// differently. A <c>create</c> reuses the catalog entry that has its deterministic id (a medication an earlier import
/// created, even if it was renamed since), else the entry whose normalized name equals the name; otherwise the new
/// medication gets that deterministic id, so the same mappings on a re-import never create it twice. Tokens without a
/// mapping are reported, never resolved by guessing.
/// </summary>
public sealed class MedicationResolver
{
    private readonly IReadOnlyDictionary<string, ImportedMedication?> _byToken;
    private readonly IReadOnlyDictionary<Guid, Medication> _newMedications;

    private MedicationResolver(IReadOnlyDictionary<string, ImportedMedication?> byToken, IReadOnlyDictionary<Guid, Medication> newMedications)
    {
        _byToken = byToken;
        _newMedications = newMedications;
    }

    public static MedicationResolver Create(Guid babyId, IReadOnlyList<Medication> catalog, IReadOnlyList<MedicationMapping> mappings, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(mappings);
        var normalizedMappings = mappings.Select(mapping => new NormalizedMapping(MedicationNameMatcher.Normalize(mapping.Token), mapping)).ToArray();
        EnsureSingleMappingPerToken(normalizedMappings);
        var index = MedicationCatalogIndex.Create(catalog);
        var newMedications = new Dictionary<Guid, Medication>();
        var byToken = normalizedMappings
            .DistinctBy(normalized => normalized.Token, StringComparer.Ordinal)
            .ToDictionary(
                normalized => normalized.Token,
                normalized => Resolve(babyId, index, normalized.Mapping, now, newMedications),
                StringComparer.Ordinal);
        return new MedicationResolver(byToken, newMedications);
    }

    public MedicationTokenResolution Resolve(IReadOnlyList<string> tokens)
    {
        ArgumentNullException.ThrowIfNull(tokens);
        var lookups = tokens.Select(token => new TokenLookup(token, _byToken.TryGetValue(MedicationNameMatcher.Normalize(token), out var medication), medication)).ToArray();
        var unmapped = lookups.Where(lookup => !lookup.IsMapped).Select(lookup => lookup.Token).ToArray();
        var medications = lookups
            .Select(lookup => lookup.Medication)
            .OfType<ImportedMedication>()
            .DistinctBy(medication => medication.MedicationId)
            .ToArray();
        return new MedicationTokenResolution(medications, unmapped);
    }

    /// <summary>Whether <paramref name="token"/> has a mapping (of any action).</summary>
    public bool IsMapped(string token) => _byToken.ContainsKey(MedicationNameMatcher.Normalize(token));

    /// <summary>The medications to add to the catalog among those <paramref name="used"/> by the events being imported.</summary>
    public IReadOnlyList<Medication> MedicationsToCreate(IEnumerable<ImportedMedication> used)
    {
        ArgumentNullException.ThrowIfNull(used);
        return used
            .Select(medication => medication.MedicationId)
            .Distinct()
            .Select(id => _newMedications.GetValueOrDefault(id))
            .OfType<Medication>()
            .ToArray();
    }

    private static ImportedMedication? Resolve(Guid babyId, MedicationCatalogIndex catalog, MedicationMapping mapping, DateTimeOffset now, Dictionary<Guid, Medication> newMedications) =>
        mapping.Action switch
        {
            MedicationMappingAction.Existing => FromCatalog(catalog, mapping),
            MedicationMappingAction.Create => FindOrPlanNew(babyId, catalog, mapping, now, newMedications),
            MedicationMappingAction.Ignore => null,
            _ => throw new InvalidMedicationMappingException(mapping.Token, $"action {mapping.Action} is not supported."),
        };

    private static ImportedMedication FromCatalog(MedicationCatalogIndex catalog, MedicationMapping mapping)
    {
        var medication = catalog.FindById(mapping.MedicationId)
            ?? throw new InvalidMedicationMappingException(mapping.Token, $"medication {mapping.MedicationId} is not in the baby's catalog.");
        return new ImportedMedication(medication.Id, medication.Name);
    }

    private static ImportedMedication FindOrPlanNew(Guid babyId, MedicationCatalogIndex catalog, MedicationMapping mapping, DateTimeOffset now, Dictionary<Guid, Medication> newMedications)
    {
        if (string.IsNullOrWhiteSpace(mapping.Name))
        {
            throw new InvalidMedicationMappingException(mapping.Token, "a name is required to create a medication.");
        }

        var normalizedName = MedicationNameMatcher.Normalize(mapping.Name);
        var derivedId = ImportIds.Medication(babyId, normalizedName);
        var existing = catalog.FindById(derivedId) ?? catalog.FindByNormalizedName(normalizedName);
        return existing is null
            ? PlanNew(babyId, mapping.Name, derivedId, now, newMedications)
            : new ImportedMedication(existing.Id, existing.Name);
    }

    private static ImportedMedication PlanNew(Guid babyId, string name, Guid id, DateTimeOffset now, Dictionary<Guid, Medication> newMedications)
    {
        var medication = newMedications.GetValueOrDefault(id) ?? Medication.Create(id, babyId, name, null, null, isUsual: false, now);
        newMedications[id] = medication;
        return new ImportedMedication(medication.Id, medication.Name);
    }

    private static void EnsureSingleMappingPerToken(IReadOnlyList<NormalizedMapping> mappings)
    {
        var conflicting = mappings
            .GroupBy(normalized => normalized.Token, StringComparer.Ordinal)
            .FirstOrDefault(group => group.Select(normalized => DecisionOf(normalized.Mapping)).Distinct(StringComparer.Ordinal).Count() > 1);
        if (conflicting is not null)
        {
            throw new InvalidMedicationMappingException(conflicting.First().Mapping.Token, "the token is mapped more than once with different decisions.");
        }
    }

    private static string DecisionOf(MedicationMapping mapping) =>
        string.Join('|', mapping.Action, mapping.MedicationId, mapping.Name is null ? null : MedicationNameMatcher.Normalize(mapping.Name));

    private sealed record NormalizedMapping(string Token, MedicationMapping Mapping);

    private sealed record TokenLookup(string Token, bool IsMapped, ImportedMedication? Medication);
}
