using BabyRoutine.Application.Imports.Csv;
using BabyRoutine.Domain.Imports;

namespace BabyRoutine.Application.Imports;

/// <summary>Rows of an export that could be read, and those that could not (with the reason).</summary>
internal sealed record ParsedRows<TRow>(IReadOnlyList<TRow> Rows, IReadOnlyList<ImportSkippedRow> Unreadable)
{
    public static ParsedRows<TRow> Empty { get; } = new([], []);
}

/// <summary>
/// Reads Napper CSV exports into typed rows (column names as in docs/SPEC.md "Napper import"). A row whose cells
/// cannot be read is reported, never aborting the file; a file without the required columns is rejected. The optional
/// pause cells (<c>numberOfPauses</c>, <c>pausedMinutes</c>) are read leniently: an unreadable one never skips the row
/// (it is reported as a skipped field where the mapping uses it).
/// </summary>
internal static class NapperCsvParser
{
    private static readonly string[] RequiredLogColumns = ["start", "end", "category"];
    private static readonly string[] RequiredMeasurementColumns = ["dateOfMeasurement"];

    public static ParsedRows<NapperLogRow> ParseLogs(string csv, string field, int maxRows)
    {
        var table = CsvTable.Read(csv, field, maxRows, RequiredLogColumns);
        var parsed = table.Rows.Select(ReadLogRow).ToArray();
        return new ParsedRows<NapperLogRow>(
            parsed.Select(result => result.Row).OfType<NapperLogRow>().ToArray(),
            parsed.Select(result => result.Unreadable).OfType<ImportSkippedRow>().ToArray());
    }

    public static ParsedRows<NapperMeasurementRow> ParseMeasurements(string csv, string field, int maxRows)
    {
        var table = CsvTable.Read(csv, field, maxRows, RequiredMeasurementColumns);
        var parsed = table.Rows.Select(ReadMeasurementRow).ToArray();
        return new ParsedRows<NapperMeasurementRow>(
            parsed.Select(result => result.Row).OfType<NapperMeasurementRow>().ToArray(),
            parsed.Select(result => result.Unreadable).OfType<ImportSkippedRow>().ToArray());
    }

    private static RowResult<NapperLogRow> ReadLogRow(CsvRow csvRow)
    {
        var cells = new CellReader(csvRow);
        var category = cells.RequiredText("category")?.ToUpperInvariant();
        var row = new NapperLogRow
        {
            RowNumber = csvRow.RowNumber,
            Category = category ?? string.Empty,
            Start = cells.RequiredTimestamp("start") ?? default,
            End = cells.Timestamp("end"),
            DiaperContent = cells.Text("diaperContent"),
            FeedingAmount = cells.Number("feedingAmount"),
            BottleFeedingType = cells.Text("bottleFeedingType"),
            BreastLeftSeconds = cells.Integer("breastLeftSeconds"),
            BreastRightSeconds = cells.Integer("breastRightSeconds"),
            AmountPumpedLeft = cells.Number("amountPumpedLeft"),
            AmountPumpedRight = cells.Number("amountPumpedRight"),
            NumberOfPauses = cells.LenientInteger("numberOfPauses"),
            PausedMinutes = cells.LenientNumber("pausedMinutes"),
            BabyMoodOnWakeUp = cells.Text("babyMoodOnWakeUp"),
            BabyMoodOnSleep = cells.Text("babyMoodOnSleep"),
            HowBabySlept = cells.Text("howBabySlept"),
            HowBabyWoke = cells.Text("howBabyWoke"),
            TimeToFallAsleep = cells.Text("timeToFallAsleep"),
            Comment = cells.Text("comment"),
            InvalidCells = cells.InvalidCells,
        };
        return RowResult<NapperLogRow>.From(row, cells.Error, csvRow.RowNumber, category);
    }

    private static RowResult<NapperMeasurementRow> ReadMeasurementRow(CsvRow csvRow)
    {
        var cells = new CellReader(csvRow);
        var row = new NapperMeasurementRow(
            csvRow.RowNumber,
            cells.RequiredDate("dateOfMeasurement") ?? default,
            cells.Number("weightKg"),
            cells.Number("heightCm"),
            cells.Number("headCircumferenceCm"));
        return RowResult<NapperMeasurementRow>.From(row, cells.Error, csvRow.RowNumber, null);
    }

    private sealed record RowResult<TRow>(TRow? Row, ImportSkippedRow? Unreadable)
        where TRow : class
    {
        public static RowResult<TRow> From(TRow row, CellError? error, int rowNumber, string? category) =>
            error is null
                ? new RowResult<TRow>(row, null)
                : new RowResult<TRow>(null, new ImportSkippedRow(rowNumber, category, error.Code, error.Reason));
    }
}
