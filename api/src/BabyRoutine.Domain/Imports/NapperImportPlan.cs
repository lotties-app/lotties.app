using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Measurements;
using BabyRoutine.Domain.Medications;

namespace BabyRoutine.Domain.Imports;

/// <summary>
/// A medication name of the rows to import, how often it occurs, the closest catalog entry (<c>null</c> = suggest
/// creating it), other names of the file within typo distance and whether a mapping was given for it.
/// </summary>
public sealed record MedicationSuggestion(string Token, int Occurrences, MedicationMatch? Match, IReadOnlyList<string> SimilarTokens, bool IsMapped);

/// <summary>Records to save in one transaction: new catalog medications first, then events, then measurements.</summary>
public sealed record ImportBatch(IReadOnlyList<Medication> Medications, IReadOnlyList<Event> Events, IReadOnlyList<Measurement> Measurements);

/// <summary>
/// The full outcome of an import before anything is written: which candidates are new and which were imported
/// before (their deterministic id already exists, soft-deleted events included, so a deleted import is not
/// resurrected), the medication names still lacking a mapping and the medications to create.
/// </summary>
public sealed class NapperImportPlan
{
    private NapperImportPlan(
        NapperEventPlan events,
        NapperMeasurementPlan measurements,
        IReadOnlySet<Guid> existingEventIds,
        IReadOnlySet<Guid> existingMeasurementIds,
        MedicationResolver medications,
        IReadOnlyList<Medication> catalog)
    {
        Events = events;
        Measurements = measurements;
        NewEvents = events.Candidates.Where(candidate => !existingEventIds.Contains(candidate.Event.Id)).ToArray();
        ImportedEvents = events.Candidates.Where(candidate => existingEventIds.Contains(candidate.Event.Id)).ToArray();
        NewMeasurements = measurements.Candidates.Where(candidate => !existingMeasurementIds.Contains(candidate.Measurement.Id)).ToArray();
        ImportedMeasurements = measurements.Candidates.Where(candidate => existingMeasurementIds.Contains(candidate.Measurement.Id)).ToArray();
        UnmappedTokens = DistinctTokens(NewEvents.SelectMany(candidate => candidate.UnmappedTokens));
        MedicationSuggestions = Suggest(NewEvents, catalog, medications);
        MedicationsToCreate = medications.MedicationsToCreate(NewEvents.SelectMany(candidate => candidate.Medications));
    }

    public NapperEventPlan Events { get; }

    public NapperMeasurementPlan Measurements { get; }

    public IReadOnlyList<NapperEventCandidate> NewEvents { get; }

    public IReadOnlyList<NapperEventCandidate> ImportedEvents { get; }

    public IReadOnlyList<NapperMeasurementCandidate> NewMeasurements { get; }

    public IReadOnlyList<NapperMeasurementCandidate> ImportedMeasurements { get; }

    /// <summary>Medication names of new medicine rows without a mapping (first spelling of each).</summary>
    public IReadOnlyList<string> UnmappedTokens { get; }

    public IReadOnlyList<MedicationSuggestion> MedicationSuggestions { get; }

    /// <summary>Catalog medications the import creates (only those referenced by new events).</summary>
    public IReadOnlyList<Medication> MedicationsToCreate { get; }

    public static NapperImportPlan Create(
        NapperEventPlan events,
        NapperMeasurementPlan measurements,
        IReadOnlySet<Guid> existingEventIds,
        IReadOnlySet<Guid> existingMeasurementIds,
        MedicationResolver medications,
        IReadOnlyList<Medication> catalog)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(measurements);
        ArgumentNullException.ThrowIfNull(existingEventIds);
        ArgumentNullException.ThrowIfNull(existingMeasurementIds);
        ArgumentNullException.ThrowIfNull(medications);
        ArgumentNullException.ThrowIfNull(catalog);
        return new NapperImportPlan(events, measurements, existingEventIds, existingMeasurementIds, medications, catalog);
    }

    /// <summary>Throws <see cref="UnmappedMedicationsException"/> when a new medicine row names a medication without a mapping.</summary>
    public void EnsureMedicationsMapped()
    {
        if (UnmappedTokens.Count > 0)
        {
            throw new UnmappedMedicationsException(UnmappedTokens);
        }
    }

    public ImportBatch ToBatch() => new(
        MedicationsToCreate,
        NewEvents.Select(candidate => candidate.Event).ToArray(),
        NewMeasurements.Select(candidate => candidate.Measurement).ToArray());

    private static IReadOnlyList<string> DistinctTokens(IEnumerable<string> tokens) =>
        tokens.DistinctBy(MedicationNameMatcher.Normalize, StringComparer.Ordinal).ToArray();

    private static IReadOnlyList<MedicationSuggestion> Suggest(IReadOnlyList<NapperEventCandidate> newEvents, IReadOnlyList<Medication> catalog, MedicationResolver medications)
    {
        var occurrences = newEvents
            .SelectMany(candidate => candidate.MedicationTokens)
            .GroupBy(MedicationNameMatcher.Normalize, StringComparer.Ordinal)
            .Select(group => new TokenOccurrence(group.First(), group.Count()))
            .ToArray();
        var tokens = occurrences.Select(occurrence => occurrence.Token).ToArray();
        return occurrences
            .Select(occurrence => new MedicationSuggestion(
                occurrence.Token,
                occurrence.Count,
                MedicationNameMatcher.FindBestMatch(occurrence.Token, catalog),
                tokens.Where(other => other != occurrence.Token && MedicationNameMatcher.AreSimilar(other, occurrence.Token)).ToArray(),
                medications.IsMapped(occurrence.Token)))
            .OrderBy(suggestion => suggestion.Token, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private sealed record TokenOccurrence(string Token, int Count);
}
