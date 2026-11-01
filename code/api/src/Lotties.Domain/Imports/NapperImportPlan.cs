using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;

namespace Lotties.Domain.Imports;

/// <summary>
/// A medication name of the rows to import, how often it occurs, the closest catalog entry (<c>null</c> = suggest
/// creating it), other names of the file within typo distance and whether a mapping was given for it.
/// </summary>
public sealed record MedicationSuggestion(string Token, int Occurrences, MedicationMatch? Match, IReadOnlyList<string> SimilarTokens, bool IsMapped);

/// <summary>
/// Records to save in one transaction: new catalog medications first, then events, then measurements, then the
/// enrichments of already imported events.
/// </summary>
public sealed record ImportBatch(IReadOnlyList<Medication> Medications, IReadOnlyList<Event> Events, IReadOnlyList<Measurement> Measurements)
{
    public IReadOnlyList<EventEnrichment> Enrichments { get; init; } = [];
}

/// <summary>
/// The full outcome of an import before anything is written: which candidates are new and which were imported
/// before (their deterministic id already exists, soft-deleted events included, so a deleted import is not
/// resurrected), the medication names still lacking a mapping, the medications to create and, when asked for, the
/// enrichments of already imported events (<see cref="NapperEventEnricher"/>).
/// </summary>
public sealed class NapperImportPlan
{
    private NapperImportPlan(
        NapperEventPlan events,
        NapperMeasurementPlan measurements,
        IReadOnlySet<Guid> existingEventIds,
        IReadOnlySet<Guid> existingMeasurementIds,
        MedicationResolver medications,
        IReadOnlyList<Medication> catalog,
        IReadOnlyList<EventEnrichment> enrichments,
        CancellationToken cancellationToken)
    {
        Events = events;
        Enrichments = enrichments;
        Measurements = measurements;
        NewEvents = events.Candidates.Where(candidate => !existingEventIds.Contains(candidate.Event.Id)).ToArray();
        ImportedEvents = events.Candidates.Where(candidate => existingEventIds.Contains(candidate.Event.Id)).ToArray();
        NewMeasurements = measurements.Candidates.Where(candidate => !existingMeasurementIds.Contains(candidate.Measurement.Id)).ToArray();
        ImportedMeasurements = measurements.Candidates.Where(candidate => existingMeasurementIds.Contains(candidate.Measurement.Id)).ToArray();
        UnmappedTokens = DistinctTokens(NewEvents.SelectMany(candidate => candidate.UnmappedTokens));
        MedicationSuggestions = Suggest(NewEvents, catalog, medications, cancellationToken);
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

    /// <summary>Already imported events whose missing detail fields the import fills (empty unless asked for).</summary>
    public IReadOnlyList<EventEnrichment> Enrichments { get; }

    public static NapperImportPlan Create(
        NapperEventPlan events,
        NapperMeasurementPlan measurements,
        IReadOnlySet<Guid> existingEventIds,
        IReadOnlySet<Guid> existingMeasurementIds,
        MedicationResolver medications,
        IReadOnlyList<Medication> catalog,
        IReadOnlyList<EventEnrichment>? enrichments = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(measurements);
        ArgumentNullException.ThrowIfNull(existingEventIds);
        ArgumentNullException.ThrowIfNull(existingMeasurementIds);
        ArgumentNullException.ThrowIfNull(medications);
        ArgumentNullException.ThrowIfNull(catalog);
        return new NapperImportPlan(events, measurements, existingEventIds, existingMeasurementIds, medications, catalog, enrichments ?? [], cancellationToken);
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
        NewMeasurements.Select(candidate => candidate.Measurement).ToArray())
    {
        Enrichments = Enrichments,
    };

    private static IReadOnlyList<string> DistinctTokens(IEnumerable<string> tokens) =>
        tokens.DistinctBy(MedicationNameMatcher.Normalize, StringComparer.Ordinal).ToArray();

    /// <remarks>
    /// Each name is normalized once and matched through length buckets with the bounded edit distance, so the work
    /// stays small for the at most <see cref="MedicationNameLimits.MaxDistinctNamesPerFile"/> names of a file.
    /// </remarks>
    private static IReadOnlyList<MedicationSuggestion> Suggest(
        IReadOnlyList<NapperEventCandidate> newEvents,
        IReadOnlyList<Medication> catalog,
        MedicationResolver medications,
        CancellationToken cancellationToken)
    {
        var occurrences = newEvents
            .SelectMany(candidate => candidate.MedicationTokens)
            .GroupBy(MedicationNameMatcher.Normalize, StringComparer.Ordinal)
            .Select(group => new TokenOccurrence(group.First(), group.Key, group.Count()))
            .ToArray();
        var catalogIndex = MedicationCatalogIndex.Create(catalog);
        var tokenIndex = SimilarNameIndex<TokenOccurrence>.Create(occurrences, occurrence => occurrence.NormalizedToken);
        return occurrences
            .Select(occurrence => SuggestionFor(occurrence, catalogIndex, tokenIndex, medications, cancellationToken))
            .OrderBy(suggestion => suggestion.Token, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static MedicationSuggestion SuggestionFor(
        TokenOccurrence occurrence,
        MedicationCatalogIndex catalog,
        SimilarNameIndex<TokenOccurrence> tokens,
        MedicationResolver medications,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var similarTokens = tokens.FindSimilar(occurrence.NormalizedToken)
            .Where(similar => !ReferenceEquals(similar.Item, occurrence))
            .Select(similar => similar.Item.Token)
            .ToArray();
        return new MedicationSuggestion(occurrence.Token, occurrence.Count, catalog.FindBestMatch(occurrence.NormalizedToken), similarTokens, medications.IsMapped(occurrence.Token));
    }

    private sealed record TokenOccurrence(string Token, string NormalizedToken, int Count);
}
