using System.Text.Json.Serialization;
using Lotties.Application.Serialization;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Imports;

namespace Lotties.Application.Imports;

/// <summary>
/// Body of <c>POST /api/v1/babies/{babyId}/import/napper/preview</c> and <c>POST .../import/napper</c>: the export
/// texts (at least one), the medication mappings (required by the import for every medication name of new rows;
/// the preview uses them when given) and options.
/// </summary>
public sealed record NapperImportRequest
{
    /// <summary>Text of the Napper logs CSV export.</summary>
    public string? LogsCsv { get; init; }

    /// <summary>Text of the Napper measurements CSV export.</summary>
    public string? MeasurementsCsv { get; init; }

    public IReadOnlyList<MedicationMappingDto>? MedicationMappings { get; init; }

    public NapperImportOptionsDto? Options { get; init; }
}

/// <summary>
/// The decision for one medication name (<see cref="Token"/>, matched case- and diacritics-insensitively):
/// <c>existing</c> + <see cref="MedicationId"/>, <c>create</c> + <see cref="Name"/>, or <c>ignore</c>.
/// </summary>
public sealed record MedicationMappingDto
{
    public required string Token { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public required MedicationMappingAction Action { get; init; }

    public Guid? MedicationId { get; init; }

    public string? Name { get; init; }

    /// <summary>Requires a non-blank token; the action-specific rules are checked by <see cref="MedicationResolver"/>.</summary>
    public static explicit operator MedicationMapping(MedicationMappingDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);
        return string.IsNullOrWhiteSpace(dto.Token)
            ? throw new DomainValidationException("medicationMappings", "Every medication mapping needs a token.")
            : new MedicationMapping(dto.Token.Trim(), dto.Action, dto.MedicationId, dto.Name?.Trim());
    }
}

/// <summary>Import options.</summary>
public sealed record NapperImportOptionsDto
{
    /// <summary>Napper categories to import (case-insensitive); <c>null</c> imports all. Rows of other categories are skipped as <c>excluded_category</c>.</summary>
    public IReadOnlyList<string>? Categories { get; init; }

    /// <summary>
    /// Also fill the missing detail fields (sleep details, <c>pause_count</c>, <c>paused_seconds</c>) of events this file
    /// imported before, never overwriting a value, never changing times, type, notes or deleted events.
    /// </summary>
    public bool EnrichExisting { get; init; }
}

/// <summary>
/// A detail value of an imported row that was left out of its payload field (kept as a notes line instead).
/// <see cref="Field"/> is the Napper column; <see cref="Code"/> is <c>invalid_value</c>.
/// </summary>
public sealed record ImportSkippedFieldResponse
{
    public int Row { get; init; }

    public string? Category { get; init; }

    public string Field { get; init; } = string.Empty;

    public string Value { get; init; } = string.Empty;

    public string Code { get; init; } = string.Empty;

    public string Reason { get; init; } = string.Empty;

    public static implicit operator ImportSkippedFieldResponse(ImportSkippedField skipped)
    {
        ArgumentNullException.ThrowIfNull(skipped);
        return new ImportSkippedFieldResponse
        {
            Row = skipped.Row,
            Category = skipped.Category,
            Field = skipped.Field,
            Value = skipped.Value,
            Code = skipped.Code,
            Reason = skipped.Reason,
        };
    }
}

/// <summary>How many already imported events got the payload field <see cref="Field"/> filled.</summary>
public sealed record EnrichedFieldCount
{
    public string Field { get; init; } = string.Empty;

    public int Count { get; init; }
}

/// <summary>A source row that is not imported. <see cref="Code"/>: see <see cref="ImportSkipCodes"/>.</summary>
public sealed record ImportSkippedRowResponse
{
    public int Row { get; init; }

    public string? Category { get; init; }

    public string Code { get; init; } = string.Empty;

    public string Reason { get; init; } = string.Empty;

    public static implicit operator ImportSkippedRowResponse(ImportSkippedRow skipped)
    {
        ArgumentNullException.ThrowIfNull(skipped);
        return new ImportSkippedRowResponse { Row = skipped.Row, Category = skipped.Category, Code = skipped.Code, Reason = skipped.Reason };
    }
}

/// <summary>Counts of one Napper category; <see cref="EventTypeKey"/> is the built-in type it maps to (<c>null</c> when unsupported).</summary>
public sealed record NapperCategorySummary
{
    public string Category { get; init; } = string.Empty;

    public string? EventTypeKey { get; init; }

    public int Total { get; init; }

    public int ToCreate { get; init; }

    public int AlreadyImported { get; init; }

    public int Skipped { get; init; }
}

/// <summary>
/// What the logs export maps to. <see cref="From"/>/<see cref="To"/> span the importable rows (new and already
/// imported; UTC). <c>totalRows = toCreate + alreadyImported + skipped</c>. <see cref="SkippedFields"/> lists the detail
/// values of importable rows that could not be mapped (the rows themselves are imported).
/// </summary>
public sealed record NapperLogsSummary
{
    public int TotalRows { get; init; }

    public int ToCreate { get; init; }

    public int AlreadyImported { get; init; }

    public int Skipped { get; init; }

    public DateTimeOffset? From { get; init; }

    public DateTimeOffset? To { get; init; }

    public IReadOnlyList<NapperCategorySummary> Categories { get; init; } = [];

    public IReadOnlyList<ImportSkippedRowResponse> SkippedRows { get; init; } = [];

    public IReadOnlyList<ImportSkippedFieldResponse> SkippedFields { get; init; } = [];
}

/// <summary>What the measurements export maps to; dates span the importable rows.</summary>
public sealed record NapperMeasurementsSummary
{
    public int TotalRows { get; init; }

    public int ToCreate { get; init; }

    public int AlreadyImported { get; init; }

    public int Skipped { get; init; }

    public DateOnly? From { get; init; }

    public DateOnly? To { get; init; }

    public IReadOnlyList<ImportSkippedRowResponse> SkippedRows { get; init; } = [];
}

/// <summary>Whether a suggestion points to an existing catalog medication or proposes creating one.</summary>
public enum MedicationSuggestionKind
{
    Existing,
    Create,
}

/// <summary>
/// A medication name found in new medicine rows. <see cref="Suggestion"/> <c>existing</c> carries the closest catalog
/// entry (<see cref="Distance"/> 0 = same name ignoring case/diacritics); <c>create</c> proposes
/// <see cref="MedicationName"/> = the token. <see cref="SimilarTokens"/> are other names of the file within typo distance.
/// </summary>
public sealed record MedicationSuggestionResponse
{
    public string Token { get; init; } = string.Empty;

    public int Occurrences { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public MedicationSuggestionKind Suggestion { get; init; }

    public Guid? MedicationId { get; init; }

    public string MedicationName { get; init; } = string.Empty;

    public int? Distance { get; init; }

    public IReadOnlyList<string> SimilarTokens { get; init; } = [];

    /// <summary>Whether the request already maps this token.</summary>
    public bool IsMapped { get; init; }

    public static implicit operator MedicationSuggestionResponse(MedicationSuggestion suggestion)
    {
        ArgumentNullException.ThrowIfNull(suggestion);
        return new MedicationSuggestionResponse
        {
            Token = suggestion.Token,
            Occurrences = suggestion.Occurrences,
            Suggestion = suggestion.Match is null ? MedicationSuggestionKind.Create : MedicationSuggestionKind.Existing,
            MedicationId = suggestion.Match?.Medication.Id,
            MedicationName = suggestion.Match?.Medication.Name ?? suggestion.Token,
            Distance = suggestion.Match?.Distance,
            SimilarTokens = suggestion.SimilarTokens,
            IsMapped = suggestion.IsMapped,
        };
    }
}

/// <summary>
/// Report of <c>POST .../import/napper/preview</c>; nothing is written. <see cref="UnmappedTokens"/> lists the
/// medication names the import would reject (422) with the mappings of the request. <see cref="EventsEnriched"/> and
/// <see cref="EnrichedFields"/> are what <c>options.enrichExisting</c> would fill (0 and empty without it).
/// </summary>
public sealed record NapperImportPreviewResponse
{
    public NapperLogsSummary? Logs { get; init; }

    public NapperMeasurementsSummary? Measurements { get; init; }

    public IReadOnlyList<MedicationSuggestionResponse> MedicationSuggestions { get; init; } = [];

    public IReadOnlyList<string> UnmappedTokens { get; init; } = [];

    public int EventsEnriched { get; init; }

    public IReadOnlyList<EnrichedFieldCount> EnrichedFields { get; init; } = [];
}

/// <summary>A catalog medication created by the import.</summary>
public sealed record CreatedMedicationResponse
{
    public Guid Id { get; init; }

    public string Name { get; init; } = string.Empty;
}

/// <summary>
/// Result of <c>POST .../import/napper</c>. The summaries are the preview of the same request (their
/// <c>toCreate</c> counts are what was created). <see cref="EventsEnriched"/>/<see cref="EnrichedFields"/>: already
/// imported events whose missing detail fields were filled (<c>options.enrichExisting</c>).
/// </summary>
public sealed record NapperImportResponse
{
    public int EventsCreated { get; init; }

    public int EventsEnriched { get; init; }

    public IReadOnlyList<EnrichedFieldCount> EnrichedFields { get; init; } = [];

    public int MeasurementsCreated { get; init; }

    public IReadOnlyList<CreatedMedicationResponse> CreatedMedications { get; init; } = [];

    public NapperLogsSummary? Logs { get; init; }

    public NapperMeasurementsSummary? Measurements { get; init; }
}
