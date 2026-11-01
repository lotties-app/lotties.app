using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Imports;
using static Lotties.Domain.Tests.Imports.ImportTestData;

namespace Lotties.Domain.Tests.Imports;

public sealed class NapperPlannerTests
{
    private static NapperEventPlan Plan(params NapperLogRow[] rows) => NapperEventPlanner.Plan(Context(), rows, []);

    [Fact]
    public void Plan_ValidRows_BuildsEventsInUtcWithDeterministicIdsAndCreator()
    {
        var row = Row("NAP", Offset, Offset.AddHours(1));

        var candidate = Assert.Single(Plan(row).Candidates);

        Assert.Equal(ImportIds.Event(BabyId, "NAP", row.Start, row.End, 0), candidate.Event.Id);
        Assert.Equal(new DateTimeOffset(2025, 9, 1, 11, 0, 0, TimeSpan.Zero), candidate.Event.StartedAt);
        Assert.Equal(TimeSpan.Zero, candidate.Event.StartedAt.Offset);
        Assert.Equal((BabyId, UserId), (candidate.Event.BabyId, candidate.Event.CreatedBy));
    }

    [Fact]
    public void Plan_SameRowsTwice_ProducesTheSameIds()
    {
        var rows = new[] { Row("NAP", Offset, Offset.AddHours(1)), Row("BOTTLE", Offset, rowNumber: 2) };

        Assert.Equal(Plan(rows).Candidates.Select(candidate => candidate.Event.Id), Plan(rows).Candidates.Select(candidate => candidate.Event.Id));
    }

    [Fact]
    public void Plan_IdenticalRows_SkipsTheRepeatAsDuplicate()
    {
        var first = Row("CHANGED_DIAPER", rowNumber: 2) with { DiaperContent = "WET" };

        var plan = Plan(first, first with { RowNumber = 12 });

        Assert.Single(plan.Candidates);
        var skipped = Assert.Single(plan.Skipped);
        Assert.Equal((12, ImportSkipCodes.DuplicateRow), (skipped.Row, skipped.Code));
        Assert.Contains("row 2", skipped.Reason, StringComparison.Ordinal);
    }

    [Fact]
    public void Plan_SameCategoryAndTimesWithDifferentContent_KeepsBothWithOrdinalIds()
    {
        var first = Row("MEDICINE") with { Comment = "Colidis e Puravit" };
        var second = first with { RowNumber = 17, Comment = "Puravit" };
        var context = Context(Resolver(null, new MedicationMapping("Colidis", MedicationMappingAction.Ignore, null, null), new MedicationMapping("Puravit", MedicationMappingAction.Create, null, "Puravit")));

        var plan = NapperEventPlanner.Plan(context, [first, second], []);

        Assert.Equal(
            [ImportIds.Event(BabyId, "MEDICINE", first.Start, first.End, 0), ImportIds.Event(BabyId, "MEDICINE", first.Start, first.End, 1)],
            plan.Candidates.Select(candidate => candidate.Event.Id));
    }

    [Fact]
    public void Plan_Medicine_PayloadListsResolvedMedicationsWithNames()
    {
        var colidis = CatalogMedication("Colidis");
        var context = Context(Resolver([colidis], new MedicationMapping("Colidis", MedicationMappingAction.Existing, colidis.Id, null)));

        var candidate = Assert.Single(NapperEventPlanner.Plan(context, [Row("MEDICINE") with { Comment = "Colidis" }], []).Candidates);

        var medication = Assert.Single(Json(candidate.Event.Payload).GetProperty("medications").EnumerateArray());
        Assert.Equal(colidis.Id, medication.GetProperty("medicationId").GetGuid());
        Assert.Equal("Colidis", medication.GetProperty("name").GetString());
    }

    [Fact]
    public void Plan_MedicineWithoutMappings_IsKeptWithUnmappedTokens()
    {
        var candidate = Assert.Single(Plan(Row("MEDICINE") with { Comment = "Colidis e Flagas" }).Candidates);

        Assert.Equal(["Colidis", "Flagas"], candidate.UnmappedTokens);
        Assert.Empty(Json(candidate.Event.Payload).GetProperty("medications").EnumerateArray());
    }

    [Fact]
    public void Plan_MedicineWithEveryTokenIgnored_IsSkipped()
    {
        var context = Context(Resolver(null, new MedicationMapping("Agua", MedicationMappingAction.Ignore, null, null)));

        var plan = NapperEventPlanner.Plan(context, [Row("MEDICINE") with { Comment = "Agua" }], []);

        Assert.Empty(plan.Candidates);
        Assert.Equal(ImportSkipCodes.MedicationsIgnored, Assert.Single(plan.Skipped).Code);
    }

    [Fact]
    public void Plan_RowBreakingEventRules_IsSkippedAsInvalidRecord()
    {
        var plan = Plan(
            Row("NAP", Offset, Offset.AddHours(-1)),
            Row("BOTTLE", rowNumber: 2) with { Comment = new string('x', Event.NotesMaxLength + 1) });

        Assert.Empty(plan.Candidates);
        Assert.All(plan.Skipped, skipped => Assert.Equal(ImportSkipCodes.InvalidRecord, skipped.Code));
    }

    [Fact]
    public void Plan_RowBreakingFieldRules_IsSkippedAsInvalidRecordNamingTheField()
    {
        var plan = Plan(
            Row("BOTTLE") with { FeedingAmount = -5m },
            Row("PUMPING", Offset, Offset.AddMinutes(10), rowNumber: 2) with { AmountPumpedRight = -1m });

        Assert.Empty(plan.Candidates);
        Assert.Equal([ImportSkipCodes.InvalidRecord, ImportSkipCodes.InvalidRecord], plan.Skipped.Select(skipped => skipped.Code));
        Assert.Contains("amount_ml", plan.Skipped[0].Reason, StringComparison.Ordinal);
        Assert.Contains("amount_right_ml", plan.Skipped[1].Reason, StringComparison.Ordinal);
    }

    [Fact]
    public void Plan_EveryMappedCategory_ProducesPayloadsThatPassTheFieldRules()
    {
        var rows = new[]
        {
            Row("BOTTLE", rowNumber: 1) with { FeedingAmount = 120m, BottleFeedingType = "BREAST_MILK" },
            Row("NURSING", Offset, Offset.AddMinutes(20), rowNumber: 2) with { BreastLeftSeconds = 600, BreastRightSeconds = 540 },
            Row("CHANGED_DIAPER", rowNumber: 3) with { DiaperContent = "MIXED" },
            Row("NAP", Offset, Offset.AddHours(1), rowNumber: 4) with { BabyMoodOnWakeUp = "HAPPY" },
            Row("NIGHT_WAKING", Offset.AddHours(2), Offset.AddHours(3), rowNumber: 5),
            Row("BED_TIME", Offset.AddHours(4), rowNumber: 6),
            Row("WOKE_UP", Offset.AddHours(5), rowNumber: 7),
            Row("PUMPING", Offset.AddHours(6), Offset.AddHours(6).AddMinutes(10), rowNumber: 8) with { AmountPumpedLeft = 40m, AmountPumpedRight = 35m },
            Row("BREAST_PUMP", Offset.AddHours(7), rowNumber: 9) with { AmountPumpedLeft = 20m },
        };

        var plan = Plan(rows);

        Assert.Empty(plan.Skipped);
        Assert.All(plan.Candidates, candidate =>
            BuiltInEventTypes.All.Single(type => type.Id == candidate.Event.TypeId).EnsureValidPayload(candidate.Event.Payload, candidate.Event.StartedAt, candidate.Event.EndedAt));
    }

    [Fact]
    public void Plan_CategoryFilter_SkipsOtherCategoriesAsExcluded()
    {
        var context = Context(categories: new HashSet<string> { "NAP" });

        var plan = NapperEventPlanner.Plan(context, [Row("NAP", Offset, Offset.AddHours(1)), Row("BOTTLE", rowNumber: 2)], []);

        Assert.Single(plan.Candidates);
        Assert.Equal(ImportSkipCodes.ExcludedCategory, Assert.Single(plan.Skipped).Code);
    }

    [Fact]
    public void Plan_UnreadableRows_AreCountedAndReportedInRowOrder()
    {
        var unreadable = new ImportSkippedRow(1, null, ImportSkipCodes.InvalidValue, "start is not a timestamp");

        var plan = NapperEventPlanner.Plan(Context(), [Row("UNKNOWN_ACTIVITY", rowNumber: 2)], [unreadable]);

        Assert.Equal(2, plan.TotalRows);
        Assert.Equal([1, 2], plan.Skipped.Select(skipped => skipped.Row));
    }

    [Fact]
    public void PlanMeasurements_DuplicateAndInvalidRows_AreSkipped()
    {
        var date = new DateOnly(2025, 9, 15);
        var rows = new[]
        {
            new NapperMeasurementRow(1, date, 4.1m, null, null),
            new NapperMeasurementRow(2, date, 4.10m, null, null),
            new NapperMeasurementRow(3, date, null, null, null),
            new NapperMeasurementRow(4, date, 99m, null, null),
        };

        var plan = NapperMeasurementPlanner.Plan(Context(), rows, []);

        var candidate = Assert.Single(plan.Candidates);
        Assert.Equal(ImportIds.Measurement(BabyId, date, 4.1m, null, null), candidate.Measurement.Id);
        Assert.Equal([ImportSkipCodes.DuplicateRow, ImportSkipCodes.InvalidRecord, ImportSkipCodes.InvalidRecord], plan.Skipped.Select(skipped => skipped.Code));
    }

    [Fact]
    public void ImportPlan_SplitsNewFromAlreadyImportedAndListsUnmappedTokens()
    {
        var events = Plan(Row("NAP", Offset, Offset.AddHours(1)), Row("MEDICINE", rowNumber: 2) with { Comment = "Flagas" }, Row("MEDICINE", Offset.AddHours(3), rowNumber: 3) with { Comment = "Flygas" });
        var existing = new HashSet<Guid> { events.Candidates[0].Event.Id };

        var plan = NapperImportPlan.Create(events, NapperMeasurementPlan.Empty, existing, new HashSet<Guid>(), Resolver(), [CatalogMedication("Flygas")]);

        Assert.Equal((2, 1), (plan.NewEvents.Count, plan.ImportedEvents.Count));
        Assert.Equal(["Flagas", "Flygas"], plan.UnmappedTokens);
        Assert.Throws<UnmappedMedicationsException>(plan.EnsureMedicationsMapped);
    }

    [Fact]
    public void ImportPlan_Suggestions_MatchCatalogTyposAndListSimilarTokens()
    {
        var flygas = CatalogMedication("Flygas");
        var events = Plan(
            Row("MEDICINE") with { Comment = "Colicaliv e flagas" },
            Row("MEDICINE", Offset.AddHours(1), rowNumber: 2) with { Comment = "Flygas" },
            Row("MEDICINE", Offset.AddHours(2), rowNumber: 3) with { Comment = "Colicaliv" });

        var plan = NapperImportPlan.Create(events, NapperMeasurementPlan.Empty, new HashSet<Guid>(), new HashSet<Guid>(), Resolver(), [flygas]);

        Assert.Equal(["Colicaliv", "flagas", "Flygas"], plan.MedicationSuggestions.Select(suggestion => suggestion.Token));
        var colicaliv = plan.MedicationSuggestions[0];
        Assert.Equal((2, (MedicationMatch?)null), (colicaliv.Occurrences, colicaliv.Match));
        var flagas = plan.MedicationSuggestions[1];
        Assert.Equal((flygas.Id, 1), (flagas.Match!.Medication.Id, flagas.Match.Distance));
        Assert.Equal(["Flygas"], flagas.SimilarTokens);
    }

    [Fact]
    public void ImportPlan_AlreadyImportedMedicineRows_NeedNoMapping()
    {
        var events = Plan(Row("MEDICINE") with { Comment = "Flagas" });
        var existing = new HashSet<Guid> { events.Candidates[0].Event.Id };

        var plan = NapperImportPlan.Create(events, NapperMeasurementPlan.Empty, existing, new HashSet<Guid>(), Resolver(), []);

        Assert.Empty(plan.UnmappedTokens);
        Assert.Empty(plan.MedicationSuggestions);
        plan.EnsureMedicationsMapped();
    }

    [Fact]
    public void ImportPlan_ToBatch_CreatesOnlyMedicationsUsedByNewEvents()
    {
        var context = Context(Resolver(null, new MedicationMapping("Flagas", MedicationMappingAction.Create, null, "Flagyl")));
        var events = NapperEventPlanner.Plan(context, [Row("MEDICINE") with { Comment = "Flagas" }], []);

        var plan = NapperImportPlan.Create(events, NapperMeasurementPlan.Empty, new HashSet<Guid>(), new HashSet<Guid>(), context.Medications, []);

        var batch = plan.ToBatch();
        Assert.Equal("Flagyl", Assert.Single(batch.Medications).Name);
        Assert.Single(batch.Events);
        Assert.Empty(batch.Measurements);
    }
}
