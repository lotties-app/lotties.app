using System.Text.Json.Nodes;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Imports;

/// <summary>Who imports into which baby, when, with which medication mappings and (optionally) only which Napper categories.</summary>
public sealed record NapperImportContext(Guid BabyId, Guid CreatedBy, DateTimeOffset Now, MedicationResolver Medications, IReadOnlySet<string>? Categories);

/// <summary>
/// A row that maps to a valid event with its deterministic id. <see cref="MedicationTokens"/> are the names of a
/// medicine row; <see cref="UnmappedTokens"/> those of them without a mapping (left out of <see cref="Event"/>'s payload).
/// <see cref="SkippedFields"/> are the row's detail values that could not be mapped.
/// </summary>
public sealed record NapperEventCandidate(
    int RowNumber,
    string Category,
    Event Event,
    IReadOnlyList<string> MedicationTokens,
    IReadOnlyList<string> UnmappedTokens,
    IReadOnlyList<ImportedMedication> Medications)
{
    public IReadOnlyList<ImportSkippedField> SkippedFields { get; init; } = [];
}

/// <summary>The events a logs export maps to and the rows that are skipped, in file order.</summary>
public sealed record NapperEventPlan(int TotalRows, IReadOnlyList<NapperEventCandidate> Candidates, IReadOnlyList<ImportSkippedRow> Skipped);

/// <summary>
/// Turns parsed Napper rows into validated <see cref="Event"/>s (built with <see cref="Event.Create"/> after the payload
/// passed <see cref="EventType.EnsureValidPayload"/>, so the same event and field rules as the API apply) with
/// deterministic ids. Rows that would create exactly the same event as an earlier row are
/// skipped as duplicates; rows that share category, start and end but differ get distinct ids by ordinal. Nothing is
/// saved: the same plan backs the preview and the import. Medicine rows may name at most
/// <see cref="MedicationNameLimits.MaxDistinctNamesPerFile"/> distinct medications (else
/// <see cref="ImportTooManyMedicationNamesException"/>), which bounds the typo matching of the plan.
/// </summary>
public static class NapperEventPlanner
{
    public static NapperEventPlan Plan(
        NapperImportContext context,
        IReadOnlyList<NapperLogRow> rows,
        IReadOnlyList<ImportSkippedRow> unparsedRows,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(unparsedRows);
        var outcomes = rows.Select(row => MapIncluded(row, context.Categories, cancellationToken)).ToArray();
        var drafts = outcomes.Select(outcome => outcome.Draft).OfType<NapperEventDraft>().ToArray();
        EnsureFewMedicationNames(drafts);
        var identified = new DraftIdentifier(context.BabyId).Identify(drafts);
        var built = identified.Drafts.Select(draft => Build(context, draft, cancellationToken)).ToArray();
        var skipped = unparsedRows
            .Concat(outcomes.Select(outcome => outcome.Skip).OfType<ImportSkippedRow>())
            .Concat(identified.Duplicates)
            .Concat(built.Select(result => result.Skip).OfType<ImportSkippedRow>())
            .OrderBy(skip => skip.Row)
            .ToArray();
        return new NapperEventPlan(rows.Count + unparsedRows.Count, built.Select(result => result.Candidate).OfType<NapperEventCandidate>().ToArray(), skipped);
    }

    private static NapperRowOutcome MapIncluded(NapperLogRow row, IReadOnlySet<string>? categories, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return categories is null || categories.Contains(row.Category)
            ? NapperEventMapper.Map(row)
            : NapperRowOutcome.Skipped(row, ImportSkipCodes.ExcludedCategory, $"Napper category '{row.Category}' was excluded from the import.");
    }

    /// <summary>Stops counting as soon as the limit is exceeded.</summary>
    private static void EnsureFewMedicationNames(IEnumerable<NapperEventDraft> drafts)
    {
        var distinctNames = new HashSet<string>(StringComparer.Ordinal);
        var exceeded = drafts
            .SelectMany(draft => draft.MedicationTokens)
            .Any(token => distinctNames.Add(MedicationNameMatcher.Normalize(token)) && distinctNames.Count > MedicationNameLimits.MaxDistinctNamesPerFile);
        if (exceeded)
        {
            throw new ImportTooManyMedicationNamesException(MedicationNameLimits.MaxDistinctNamesPerFile);
        }
    }

    private static BuildResult Build(NapperImportContext context, IdentifiedDraft identified, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var draft = identified.Draft;
        var resolution = context.Medications.Resolve(draft.MedicationTokens);
        if (draft.MedicationTokens.Count > 0 && resolution.Medications.Count == 0 && resolution.Unmapped.Count == 0)
        {
            return BuildResult.Skipped(draft, ImportSkipCodes.MedicationsIgnored, "every medication of the row is mapped to ignore.");
        }

        return TryCreateEvent(context, identified, resolution);
    }

    private static BuildResult TryCreateEvent(NapperImportContext context, IdentifiedDraft identified, MedicationTokenResolution resolution)
    {
        var draft = identified.Draft;
        try
        {
            var payload = draft.MedicationTokens.Count > 0 ? MedicationPayload(resolution.Medications) : draft.Payload;
            draft.Type.EnsureValidPayload(payload, draft.StartedAt, draft.EndedAt);
            var created = Event.Create(identified.Id, context.BabyId, draft.Type.Id, context.CreatedBy, draft.StartedAt, draft.EndedAt, payload, draft.Notes, context.Now);
            var candidate = new NapperEventCandidate(draft.Source.RowNumber, draft.Source.Category, created, draft.MedicationTokens, resolution.Unmapped, resolution.Medications)
            {
                SkippedFields = draft.SkippedFields,
            };
            return BuildResult.Built(candidate);
        }
        catch (DomainException exception)
        {
            return BuildResult.Skipped(draft, ImportSkipCodes.InvalidRecord, exception.Message);
        }
    }

    private static EventPayload MedicationPayload(IReadOnlyList<ImportedMedication> medications)
    {
        var items = medications.Select(medication => (JsonNode)new JsonObject
        {
            ["medicationId"] = medication.MedicationId.ToString("D"),
            ["name"] = medication.Name,
        });
        return new PayloadBuilder().With("medications", new JsonArray(items.ToArray())).Build();
    }

    private sealed record IdentifiedDraft(Guid Id, NapperEventDraft Draft);

    private sealed record IdentifiedDrafts(IReadOnlyList<IdentifiedDraft> Drafts, IReadOnlyList<ImportSkippedRow> Duplicates);

    private sealed record BuildResult(NapperEventCandidate? Candidate, ImportSkippedRow? Skip)
    {
        public static BuildResult Built(NapperEventCandidate candidate) => new(candidate, null);

        public static BuildResult Skipped(NapperEventDraft draft, string code, string reason) =>
            new(null, new ImportSkippedRow(draft.Source.RowNumber, draft.Source.Category, code, reason));
    }

    /// <summary>Assigns ids in file order: the n-th distinct content among rows of the same source key gets ordinal n.</summary>
    private sealed class DraftIdentifier(Guid babyId)
    {
        private readonly Dictionary<string, int> _rowByContent = new(StringComparer.Ordinal);
        private readonly Dictionary<string, int> _nextOrdinalBySource = new(StringComparer.Ordinal);
        private readonly List<IdentifiedDraft> _drafts = [];
        private readonly List<ImportSkippedRow> _duplicates = [];

        public IdentifiedDrafts Identify(IEnumerable<NapperEventDraft> drafts)
        {
            foreach (var draft in drafts)
            {
                Add(draft);
            }

            return new IdentifiedDrafts(_drafts.ToArray(), _duplicates.ToArray());
        }

        private void Add(NapperEventDraft draft)
        {
            var source = draft.Source;
            var sourceKey = string.Join('|', source.Category, source.Start.UtcTicks, source.End?.UtcTicks);
            var contentKey = sourceKey + '\u001d' + draft.ContentKey;
            if (_rowByContent.TryGetValue(contentKey, out var firstRow))
            {
                _duplicates.Add(new ImportSkippedRow(source.RowNumber, source.Category, ImportSkipCodes.DuplicateRow, $"same as row {firstRow}."));
                return;
            }

            var ordinal = _nextOrdinalBySource.GetValueOrDefault(sourceKey);
            _nextOrdinalBySource[sourceKey] = ordinal + 1;
            _rowByContent[contentKey] = source.RowNumber;
            _drafts.Add(new IdentifiedDraft(ImportIds.Event(babyId, source.Category, source.Start, source.End, ordinal), draft));
        }
    }
}
