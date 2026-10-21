namespace BabyRoutine.Domain.Imports;

/// <summary>
/// One parsed row of a Napper logs export. <see cref="RowNumber"/> is the 1-based data record number (the header is
/// not counted). Timestamps keep the offset of the export; empty cells are <c>null</c>.
/// </summary>
public sealed record NapperLogRow
{
    public required int RowNumber { get; init; }

    /// <summary>Napper category in upper case, e.g. <c>BOTTLE</c>.</summary>
    public required string Category { get; init; }

    public required DateTimeOffset Start { get; init; }

    public DateTimeOffset? End { get; init; }

    public string? DiaperContent { get; init; }

    public decimal? FeedingAmount { get; init; }

    public string? BottleFeedingType { get; init; }

    public int? BreastLeftSeconds { get; init; }

    public int? BreastRightSeconds { get; init; }

    public decimal? AmountPumpedLeft { get; init; }

    public decimal? AmountPumpedRight { get; init; }

    public int? NumberOfPauses { get; init; }

    public decimal? PausedMinutes { get; init; }

    public string? BabyMoodOnWakeUp { get; init; }

    public string? BabyMoodOnSleep { get; init; }

    public string? HowBabySlept { get; init; }

    public string? HowBabyWoke { get; init; }

    public string? TimeToFallAsleep { get; init; }

    public string? Comment { get; init; }
}

/// <summary>One parsed row of a Napper measurements export; <see cref="RowNumber"/> is the 1-based data record number.</summary>
public sealed record NapperMeasurementRow(int RowNumber, DateOnly Date, decimal? WeightKg, decimal? HeightCm, decimal? HeadCircumferenceCm);

/// <summary>A source row that will not be imported, with a stable <see cref="Code"/> (see <see cref="ImportSkipCodes"/>).</summary>
public sealed record ImportSkippedRow(int Row, string? Category, string Code, string Reason);

/// <summary>Stable machine-readable reasons for skipped rows.</summary>
public static class ImportSkipCodes
{
    /// <summary>The Napper category has no mapping.</summary>
    public const string UnknownCategory = "unknown_category";

    /// <summary>The category was left out by the import options.</summary>
    public const string ExcludedCategory = "excluded_category";

    /// <summary>A cell could not be parsed (timestamp, number, date).</summary>
    public const string InvalidValue = "invalid_value";

    /// <summary>A cell the mapping needs is empty or not one of the accepted values.</summary>
    public const string MissingValue = "missing_value";

    /// <summary>The row would create exactly the same record as an earlier row of the file.</summary>
    public const string DuplicateRow = "duplicate_row";

    /// <summary>The mapped record breaks a domain rule (e.g. end before start, notes too long, value out of range).</summary>
    public const string InvalidRecord = "invalid_record";

    /// <summary>Every medication of a medicine row was mapped to <c>ignore</c>.</summary>
    public const string MedicationsIgnored = "medications_ignored";
}
