using System.Diagnostics;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Imports;
using static Lotties.Domain.Tests.Imports.ImportTestData;

namespace Lotties.Domain.Tests.Imports;

public sealed class MedicationNameLimitTests
{
    private static readonly TimeSpan GenerousBound = TimeSpan.FromSeconds(5);

    private static NapperLogRow Medicine(int rowNumber, string comment) =>
        Row("MEDICINE", Offset.AddMinutes(rowNumber), rowNumber: rowNumber) with { Comment = comment };

    private static string Name(int index) => $"med{index:D5}x";

    private static string RandomName(Random random) =>
        new(Enumerable.Range(0, 10).Select(_ => (char)('a' + random.Next(26))).ToArray());

    [Fact]
    public void Plan_MoreDistinctNamesThanAllowed_Throws()
    {
        var rows = Enumerable.Range(1, MedicationNameLimits.MaxDistinctNamesPerFile + 1).Select(index => Medicine(index, Name(index))).ToArray();

        var exception = Assert.Throws<ImportTooManyMedicationNamesException>(() => NapperEventPlanner.Plan(Context(), rows, []));

        Assert.Equal("import_too_many_medication_names", exception.Code);
        Assert.Equal(MedicationNameLimits.MaxDistinctNamesPerFile, exception.Details["maxNames"]);
    }

    [Fact]
    public void Plan_NamesThatNormalizeEqual_CountOnce()
    {
        var rows = Enumerable.Range(1, MedicationNameLimits.MaxDistinctNamesPerFile)
            .SelectMany(index => new[] { Medicine(index, Name(index)), Medicine(index + 100_000, Name(index).ToUpperInvariant()) })
            .ToArray();

        var plan = NapperEventPlanner.Plan(Context(), rows, []);

        Assert.Equal(rows.Length, plan.Candidates.Count);
    }

    [Fact]
    public void Plan_NameLongerThanTheLimit_SkipsTheRowAsInvalidRecord()
    {
        var plan = NapperEventPlanner.Plan(
            Context(),
            [Medicine(1, "Colidis e " + new string('x', MedicationNameLimits.MaxNameLength + 1)), Medicine(2, new string('y', MedicationNameLimits.MaxNameLength))],
            []);

        var skipped = Assert.Single(plan.Skipped);
        Assert.Equal((1, ImportSkipCodes.InvalidRecord), (skipped.Row, skipped.Code));
        Assert.Contains($"{MedicationNameLimits.MaxNameLength} characters", skipped.Reason, StringComparison.Ordinal);
        Assert.Equal(2, Assert.Single(plan.Candidates).RowNumber);
    }

    [Fact]
    public void Plan_HostileFileWithTensOfThousandsOfNames_FailsFast()
    {
        var rows = Enumerable.Range(1, 20_000).Select(index => Medicine(index, $"{Name(index)}a, {Name(index)}b, {Name(index)}c")).ToArray();
        var stopwatch = Stopwatch.StartNew();

        Assert.Throws<ImportTooManyMedicationNamesException>(() => NapperEventPlanner.Plan(Context(), rows, []));

        Assert.True(stopwatch.Elapsed < GenerousBound, $"took {stopwatch.Elapsed}");
    }

    [Fact]
    public void ImportPlan_MaxDistinctNamesAndALargeCatalog_SuggestsQuickly()
    {
        var random = new Random(11);
        var rows = Enumerable.Range(1, MedicationNameLimits.MaxDistinctNamesPerFile).Select(index => Medicine(index, RandomName(random))).ToArray();
        var catalog = Enumerable.Range(0, 1_000).Select(_ => CatalogMedication(RandomName(random))).ToArray();
        var stopwatch = Stopwatch.StartNew();

        var events = NapperEventPlanner.Plan(Context(), rows, []);
        var plan = NapperImportPlan.Create(events, NapperMeasurementPlan.Empty, new HashSet<Guid>(), new HashSet<Guid>(), Resolver(catalog), catalog);

        Assert.True(stopwatch.Elapsed < GenerousBound, $"took {stopwatch.Elapsed}");
        Assert.Equal(MedicationNameLimits.MaxDistinctNamesPerFile, plan.MedicationSuggestions.Count);
    }

    [Fact]
    public void ImportPlan_SimilarTokens_MatchTheFullComparison()
    {
        var rows = new[] { "Simeticona", "Simeticone", "Simeticon", "Flagas", "Flygas", "Flagyl", "Vit", "Vix" }
            .Select((name, index) => Medicine(index + 1, name))
            .ToArray();
        var events = NapperEventPlanner.Plan(Context(), rows, []);

        var plan = NapperImportPlan.Create(events, NapperMeasurementPlan.Empty, new HashSet<Guid>(), new HashSet<Guid>(), Resolver(), []);

        var byToken = plan.MedicationSuggestions.ToDictionary(suggestion => suggestion.Token);
        Assert.Equal(["Simeticone", "Simeticon"], byToken["Simeticona"].SimilarTokens);
        Assert.Equal(["Flygas"], byToken["Flagas"].SimilarTokens);
        Assert.Empty(byToken["Vit"].SimilarTokens);
    }

    [Fact]
    public void Plan_CancelledToken_Throws()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        Assert.ThrowsAny<OperationCanceledException>(() => NapperEventPlanner.Plan(Context(), [Medicine(1, "Colidis")], [], cancellation.Token));
    }

    [Fact]
    public void ImportPlan_CancelledToken_Throws()
    {
        var events = NapperEventPlanner.Plan(Context(), [Medicine(1, "Colidis")], []);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        Assert.ThrowsAny<OperationCanceledException>(() =>
            NapperImportPlan.Create(events, NapperMeasurementPlan.Empty, new HashSet<Guid>(), new HashSet<Guid>(), Resolver(), [], cancellationToken: cancellation.Token));
    }
}
