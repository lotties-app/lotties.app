using Lotties.Domain.Exceptions;
using Lotties.Domain.Measurements;

namespace Lotties.Domain.Imports;

/// <summary>A measurements row that maps to a valid <see cref="Measurement"/> with its deterministic id.</summary>
public sealed record NapperMeasurementCandidate(int RowNumber, Measurement Measurement);

/// <summary>The measurements an export maps to and the rows that are skipped, in file order.</summary>
public sealed record NapperMeasurementPlan(int TotalRows, IReadOnlyList<NapperMeasurementCandidate> Candidates, IReadOnlyList<ImportSkippedRow> Skipped)
{
    public static NapperMeasurementPlan Empty { get; } = new(0, [], []);
}

/// <summary>
/// Turns parsed measurement rows into validated <see cref="Measurement"/>s (via <see cref="Measurement.Create"/>)
/// whose id derives from baby, date and values, so the same row is recognized on a re-import and an identical row
/// in the same file is skipped as a duplicate.
/// </summary>
public static class NapperMeasurementPlanner
{
    public static NapperMeasurementPlan Plan(NapperImportContext context, IReadOnlyList<NapperMeasurementRow> rows, IReadOnlyList<ImportSkippedRow> unparsedRows)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(unparsedRows);
        var firstRowById = new Dictionary<Guid, int>();
        var results = rows.Select(row => Build(context, row, firstRowById)).ToArray();
        var skipped = unparsedRows.Concat(results.Select(result => result.Skip).OfType<ImportSkippedRow>()).OrderBy(skip => skip.Row).ToArray();
        return new NapperMeasurementPlan(rows.Count + unparsedRows.Count, results.Select(result => result.Candidate).OfType<NapperMeasurementCandidate>().ToArray(), skipped);
    }

    private static BuildResult Build(NapperImportContext context, NapperMeasurementRow row, Dictionary<Guid, int> firstRowById)
    {
        var id = ImportIds.Measurement(context.BabyId, row.Date, row.WeightKg, row.HeightCm, row.HeadCircumferenceCm);
        if (firstRowById.TryGetValue(id, out var firstRow))
        {
            return BuildResult.Skipped(row, ImportSkipCodes.DuplicateRow, $"same as row {firstRow}.");
        }

        firstRowById[id] = row.RowNumber;
        return TryCreate(context, row, id);
    }

    private static BuildResult TryCreate(NapperImportContext context, NapperMeasurementRow row, Guid id)
    {
        try
        {
            var measurement = Measurement.Create(id, context.BabyId, row.Date, row.WeightKg, row.HeightCm, row.HeadCircumferenceCm, null, context.CreatedBy, context.Now);
            return new BuildResult(new NapperMeasurementCandidate(row.RowNumber, measurement), null);
        }
        catch (DomainException exception)
        {
            return BuildResult.Skipped(row, ImportSkipCodes.InvalidRecord, exception.Message);
        }
    }

    private sealed record BuildResult(NapperMeasurementCandidate? Candidate, ImportSkippedRow? Skip)
    {
        public static BuildResult Skipped(NapperMeasurementRow row, string code, string reason) => new(null, new ImportSkippedRow(row.RowNumber, null, code, reason));
    }
}
