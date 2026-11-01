using BabyRoutine.Domain.Imports;

namespace BabyRoutine.Application.Imports;

/// <summary>Maps a <see cref="NapperImportPlan"/> to the preview and import responses.</summary>
internal static class NapperImportReports
{
    public static NapperImportPreviewResponse Preview(NapperImportPlan plan, bool hasLogs, bool hasMeasurements) => new()
    {
        Logs = hasLogs ? Logs(plan) : null,
        Measurements = hasMeasurements ? Measurements(plan) : null,
        MedicationSuggestions = plan.MedicationSuggestions.Select(suggestion => (MedicationSuggestionResponse)suggestion).ToArray(),
        UnmappedTokens = plan.UnmappedTokens,
    };

    public static NapperImportResponse Imported(NapperImportPlan plan, bool hasLogs, bool hasMeasurements) => new()
    {
        EventsCreated = plan.NewEvents.Count,
        MeasurementsCreated = plan.NewMeasurements.Count,
        CreatedMedications = plan.MedicationsToCreate.Select(medication => new CreatedMedicationResponse { Id = medication.Id, Name = medication.Name }).ToArray(),
        Logs = hasLogs ? Logs(plan) : null,
        Measurements = hasMeasurements ? Measurements(plan) : null,
    };

    private static NapperLogsSummary Logs(NapperImportPlan plan)
    {
        var importable = plan.Events.Candidates.Select(candidate => candidate.Event).ToArray();
        return new NapperLogsSummary
        {
            TotalRows = plan.Events.TotalRows,
            ToCreate = plan.NewEvents.Count,
            AlreadyImported = plan.ImportedEvents.Count,
            Skipped = plan.Events.Skipped.Count,
            From = importable.Length == 0 ? null : importable.Min(stored => stored.StartedAt),
            To = importable.Length == 0 ? null : importable.Max(stored => stored.EndedAt ?? stored.StartedAt),
            Categories = Categories(plan),
            SkippedRows = plan.Events.Skipped.Select(skipped => (ImportSkippedRowResponse)skipped).ToArray(),
        };
    }

    private static IReadOnlyList<NapperCategorySummary> Categories(NapperImportPlan plan)
    {
        var rows = plan.NewEvents.Select(candidate => new CategoryRow(candidate.Category, CategoryOutcome.ToCreate))
            .Concat(plan.ImportedEvents.Select(candidate => new CategoryRow(candidate.Category, CategoryOutcome.AlreadyImported)))
            .Concat(plan.Events.Skipped.Where(skipped => !string.IsNullOrEmpty(skipped.Category)).Select(skipped => new CategoryRow(skipped.Category!, CategoryOutcome.Skipped)));
        return rows
            .GroupBy(row => row.Category, StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group => new NapperCategorySummary
            {
                Category = group.Key,
                EventTypeKey = NapperEventMapper.TypeFor(group.Key)?.Key.Value,
                Total = group.Count(),
                ToCreate = group.Count(row => row.Outcome == CategoryOutcome.ToCreate),
                AlreadyImported = group.Count(row => row.Outcome == CategoryOutcome.AlreadyImported),
                Skipped = group.Count(row => row.Outcome == CategoryOutcome.Skipped),
            })
            .ToArray();
    }

    private static NapperMeasurementsSummary Measurements(NapperImportPlan plan)
    {
        var dates = plan.Measurements.Candidates.Select(candidate => candidate.Measurement.Date).ToArray();
        return new NapperMeasurementsSummary
        {
            TotalRows = plan.Measurements.TotalRows,
            ToCreate = plan.NewMeasurements.Count,
            AlreadyImported = plan.ImportedMeasurements.Count,
            Skipped = plan.Measurements.Skipped.Count,
            From = dates.Length == 0 ? null : dates.Min(),
            To = dates.Length == 0 ? null : dates.Max(),
            SkippedRows = plan.Measurements.Skipped.Select(skipped => (ImportSkippedRowResponse)skipped).ToArray(),
        };
    }

    private enum CategoryOutcome
    {
        ToCreate,
        AlreadyImported,
        Skipped,
    }

    private sealed record CategoryRow(string Category, CategoryOutcome Outcome);
}
