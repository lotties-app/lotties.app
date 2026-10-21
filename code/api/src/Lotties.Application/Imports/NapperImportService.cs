using System.Text;
using Lotties.Application.Users;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Imports;
using Lotties.Domain.Medications;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Imports;

/// <summary>
/// Preview and import share one plan (<see cref="BuildPlanAsync"/>), so the preview of a request reports exactly
/// what its import creates. Ids are deterministic (<see cref="ImportIds"/>): rows whose record already exists are
/// counted as already imported, which makes re-importing an export a no-op. With <c>options.enrichExisting</c> the plan
/// also fills the missing detail fields of those already imported events (<see cref="NapperEventEnricher"/>), saved in
/// the same transaction as the inserts.
/// </summary>
internal sealed class NapperImportService : INapperImportService
{
    /// <summary>Largest accepted export text, per file, in UTF-8 bytes.</summary>
    public const int MaxFileBytes = 5 * 1024 * 1024;

    /// <summary>Largest accepted number of data rows per file.</summary>
    public const int MaxRows = 20_000;

    private const string LogsField = "logsCsv";
    private const string MeasurementsField = "measurementsCsv";

    private readonly IImportRepository _imports;
    private readonly IMedicationRepository _medications;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<NapperImportService> _logger;

    public NapperImportService(
        IImportRepository imports,
        IMedicationRepository medications,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<NapperImportService> logger)
    {
        _imports = imports ?? throw new ArgumentNullException(nameof(imports));
        _medications = medications ?? throw new ArgumentNullException(nameof(medications));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<NapperImportPreviewResponse> PreviewAsync(Guid babyId, NapperImportRequest request, CancellationToken cancellationToken = default)
    {
        var plan = await BuildPlanAsync(babyId, request, cancellationToken);
        return NapperImportReports.Preview(plan, HasLogs(request), HasMeasurements(request));
    }

    public async Task<NapperImportResponse> ImportAsync(Guid babyId, NapperImportRequest request, CancellationToken cancellationToken = default)
    {
        var plan = await BuildPlanAsync(babyId, request, cancellationToken);
        plan.EnsureMedicationsMapped();
        await _imports.SaveAsync(plan.ToBatch(), cancellationToken);
        _logger.LogInformation(
            "Imported Napper export into baby {BabyId}: {EventCount} events, {MeasurementCount} measurements, {MedicationCount} new medications, {EnrichedCount} events enriched",
            babyId,
            plan.NewEvents.Count,
            plan.NewMeasurements.Count,
            plan.MedicationsToCreate.Count,
            plan.Enrichments.Count);
        return NapperImportReports.Imported(plan, HasLogs(request), HasMeasurements(request));
    }

    private async Task<NapperImportPlan> BuildPlanAsync(Guid babyId, NapperImportRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureInput(request);
        var logs = ParseLogs(request);
        var measurementRows = ParseMeasurements(request);
        var catalog = await _medications.ListForBabyAsync(babyId, cancellationToken);
        var context = await CreateContextAsync(babyId, request, catalog, cancellationToken);
        var events = NapperEventPlanner.Plan(context, logs.Rows, logs.Unreadable, cancellationToken);
        var measurements = NapperMeasurementPlanner.Plan(context, measurementRows.Rows, measurementRows.Unreadable);
        var existingEventIds = await _imports.FindExistingEventIdsAsync(events.Candidates.Select(candidate => candidate.Event.Id).ToArray(), cancellationToken);
        var existingMeasurementIds = await _imports.FindExistingMeasurementIdsAsync(measurements.Candidates.Select(candidate => candidate.Measurement.Id).ToArray(), cancellationToken);
        var enrichments = await PlanEnrichmentsAsync(babyId, request, events, existingEventIds, context.Now, cancellationToken);
        return NapperImportPlan.Create(events, measurements, existingEventIds, existingMeasurementIds, context.Medications, catalog, enrichments, cancellationToken);
    }

    private async Task<IReadOnlyList<EventEnrichment>> PlanEnrichmentsAsync(
        Guid babyId,
        NapperImportRequest request,
        NapperEventPlan events,
        IReadOnlySet<Guid> existingEventIds,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (request.Options?.EnrichExisting != true)
        {
            return [];
        }

        var alreadyImported = events.Candidates.Where(candidate => existingEventIds.Contains(candidate.Event.Id)).ToArray();
        var stored = await _imports.FindEventsAsync(babyId, alreadyImported.Select(candidate => candidate.Event.Id).ToArray(), cancellationToken);
        return NapperEventEnricher.Plan(alreadyImported, stored, now, cancellationToken);
    }

    private async Task<NapperImportContext> CreateContextAsync(Guid babyId, NapperImportRequest request, IReadOnlyList<Medication> catalog, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var now = _timeProvider.GetUtcNow();
        var mappings = (request.MedicationMappings ?? []).Select(mapping => (MedicationMapping)mapping).ToArray();
        var resolver = MedicationResolver.Create(babyId, catalog, mappings, now);
        return new NapperImportContext(babyId, user.Id, now, resolver, CategoriesOf(request.Options));
    }

    private static ParsedRows<NapperLogRow> ParseLogs(NapperImportRequest request) =>
        HasLogs(request) ? NapperCsvParser.ParseLogs(request.LogsCsv!, LogsField, MaxRows) : ParsedRows<NapperLogRow>.Empty;

    private static ParsedRows<NapperMeasurementRow> ParseMeasurements(NapperImportRequest request) =>
        HasMeasurements(request) ? NapperCsvParser.ParseMeasurements(request.MeasurementsCsv!, MeasurementsField, MaxRows) : ParsedRows<NapperMeasurementRow>.Empty;

    private static IReadOnlySet<string>? CategoriesOf(NapperImportOptionsDto? options) =>
        options?.Categories?.Where(category => !string.IsNullOrWhiteSpace(category)).Select(category => category.Trim().ToUpperInvariant()).ToHashSet(StringComparer.Ordinal);

    private static bool HasLogs(NapperImportRequest request) => !string.IsNullOrWhiteSpace(request.LogsCsv);

    private static bool HasMeasurements(NapperImportRequest request) => !string.IsNullOrWhiteSpace(request.MeasurementsCsv);

    private static void EnsureInput(NapperImportRequest request)
    {
        if (!HasLogs(request) && !HasMeasurements(request))
        {
            throw new DomainValidationException(LogsField, "Provide logsCsv, measurementsCsv or both.");
        }

        EnsureWithinSize(request.LogsCsv, LogsField);
        EnsureWithinSize(request.MeasurementsCsv, MeasurementsField);
    }

    private static void EnsureWithinSize(string? csv, string field)
    {
        if (csv is not null && Encoding.UTF8.GetByteCount(csv) > MaxFileBytes)
        {
            throw new ImportFileTooLargeException(field, MaxFileBytes);
        }
    }
}
