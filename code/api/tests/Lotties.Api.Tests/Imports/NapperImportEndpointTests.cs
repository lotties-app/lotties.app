using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Imports;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Imports;

public sealed class NapperImportEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly string LogsCsv = Fixture("napper-logs.csv");
    private static readonly string MeasurementsCsv = Fixture("napper-measurements.csv");

    private static string Fixture(string name) => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Imports", "Fixtures", name));

    private static string PreviewPath(Guid babyId) => $"/api/v1/babies/{babyId}/import/napper/preview";

    private static string ImportPath(Guid babyId) => $"/api/v1/babies/{babyId}/import/napper";

    private static object Body(object[]? mappings = null, string? logsCsv = null, string? measurementsCsv = null, object? options = null) =>
        new { logsCsv = logsCsv ?? LogsCsv, measurementsCsv = measurementsCsv ?? MeasurementsCsv, medicationMappings = mappings, options };

    private static object Existing(string token, Guid medicationId) => new { token, action = "existing", medicationId };

    private static object Create(string token, string name) => new { token, action = "create", name };

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private async Task<Catalog> SeedCatalogAsync(SeededBaby baby)
    {
        var client = As(baby, BabyRole.Owner);
        var colidis = Guid.NewGuid();
        var flygas = Guid.NewGuid();
        await client.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/medications/{colidis}", new { name = "Colidis", isUsual = true });
        await client.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/medications/{flygas}", new { name = "Flygas", isUsual = false });
        return new Catalog(colidis, flygas);
    }

    private static object[] FullMappings(Catalog catalog) =>
    [
        Existing("Colidis", catalog.ColidisId),
        Create("Puravit", "Puravit"),
        Create("colicaliv", "Colicaliv"),
        Existing("Flagas", catalog.FlygasId),
        Existing("Flygas", catalog.FlygasId),
    ];

    private Task<int> EventCountAsync(Guid babyId) =>
        factory.QueryAsync(context => context.EventsIncludingDeleted.CountAsync(stored => stored.BabyId == babyId));

    private Task<int> MeasurementCountAsync(Guid babyId) =>
        factory.QueryAsync(context => context.Measurements.CountAsync(stored => stored.BabyId == babyId));

    private Task<int> MedicationCountAsync(Guid babyId) =>
        factory.QueryAsync(context => context.Medications.CountAsync(stored => stored.BabyId == babyId));

    [Fact]
    public async Task Preview_Fixture_ReportsCountsCategoriesRangeAndSkippedRows()
    {
        var baby = await factory.SeedBabyAsync();

        var preview = await (await As(baby, BabyRole.Owner).PostAsJsonAsync(PreviewPath(baby.BabyId), Body())).ReadAsync<NapperImportPreviewResponse>();

        var logs = preview.Logs!;
        Assert.Equal((21, 17, 0, 4), (logs.TotalRows, logs.ToCreate, logs.AlreadyImported, logs.Skipped));
        Assert.Equal(new DateTimeOffset(2025, 9, 1, 11, 0, 0, TimeSpan.Zero), logs.From);
        Assert.Equal(new DateTimeOffset(2025, 9, 2, 22, 0, 0, TimeSpan.Zero), logs.To);
        Assert.Equal(
            [(12, "duplicate_row"), (14, "unknown_category"), (15, "missing_value"), (16, "invalid_value")],
            logs.SkippedRows.Select(skipped => (skipped.Row, skipped.Code)));
        var bottle = logs.Categories.Single(category => category.Category == "BOTTLE");
        Assert.Equal(("feeding", 3, 2, 1), (bottle.EventTypeKey, bottle.Total, bottle.ToCreate, bottle.Skipped));
        Assert.Equal(4, logs.Categories.Single(category => category.Category == "MEDICINE").ToCreate);
        Assert.Null(logs.Categories.Single(category => category.Category == "UNKNOWN_ACTIVITY").EventTypeKey);
        var measurements = preview.Measurements!;
        Assert.Equal((6, 3, 0, 3), (measurements.TotalRows, measurements.ToCreate, measurements.AlreadyImported, measurements.Skipped));
        Assert.Equal((new DateOnly(2025, 8, 31), new DateOnly(2025, 10, 5)), (measurements.From!.Value, measurements.To!.Value));
    }

    [Fact]
    public async Task Preview_WithCatalog_SuggestsMatchesForTyposAndNewNames()
    {
        var baby = await factory.SeedBabyAsync();
        var catalog = await SeedCatalogAsync(baby);

        var preview = await (await As(baby, BabyRole.Owner).PostAsJsonAsync(PreviewPath(baby.BabyId), Body())).ReadAsync<NapperImportPreviewResponse>();

        Assert.Equal(["Colidis", "Puravit", "Colicaliv", "flagas", "Flygas"], preview.UnmappedTokens);
        var byToken = preview.MedicationSuggestions.ToDictionary(suggestion => suggestion.Token);
        Assert.Equal((MedicationSuggestionKind.Existing, catalog.ColidisId, 0), (byToken["Colidis"].Suggestion, byToken["Colidis"].MedicationId!.Value, byToken["Colidis"].Distance!.Value));
        Assert.Equal((MedicationSuggestionKind.Existing, catalog.FlygasId, 1), (byToken["flagas"].Suggestion, byToken["flagas"].MedicationId!.Value, byToken["flagas"].Distance!.Value));
        Assert.Equal(["Flygas"], byToken["flagas"].SimilarTokens);
        Assert.Equal((MedicationSuggestionKind.Create, "Puravit", 2), (byToken["Puravit"].Suggestion, byToken["Puravit"].MedicationName, byToken["Puravit"].Occurrences));
        Assert.All(preview.MedicationSuggestions, suggestion => Assert.False(suggestion.IsMapped));
    }

    [Fact]
    public async Task Preview_WritesNothing()
    {
        var baby = await factory.SeedBabyAsync();
        var catalog = await SeedCatalogAsync(baby);

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(PreviewPath(baby.BabyId), Body(FullMappings(catalog)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal((0, 0, 2), (await EventCountAsync(baby.BabyId), await MeasurementCountAsync(baby.BabyId), await MedicationCountAsync(baby.BabyId)));
        Assert.Empty((await response.ReadAsync<NapperImportPreviewResponse>()).UnmappedTokens);
    }

    [Fact]
    public async Task Import_WithMappings_CreatesExactlyWhatThePreviewReported()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var catalog = await SeedCatalogAsync(baby);
        var client = As(baby, BabyRole.Parent);
        var preview = await (await client.PostAsJsonAsync(PreviewPath(baby.BabyId), Body(FullMappings(catalog)))).ReadAsync<NapperImportPreviewResponse>();

        var imported = await (await client.PostAsJsonAsync(ImportPath(baby.BabyId), Body(FullMappings(catalog)))).ReadAsync<NapperImportResponse>();

        Assert.Equal((preview.Logs!.ToCreate, preview.Measurements!.ToCreate), (imported.EventsCreated, imported.MeasurementsCreated));
        Assert.Equal((17, 3), (await EventCountAsync(baby.BabyId), await MeasurementCountAsync(baby.BabyId)));
        Assert.Equal(["Colicaliv", "Puravit"], imported.CreatedMedications.Select(medication => medication.Name).Order());
        Assert.Equal(4, await MedicationCountAsync(baby.BabyId));
        Assert.Equal(preview.Logs.SkippedRows, imported.Logs!.SkippedRows);
    }

    [Fact]
    public async Task Import_StoresEventsWithCreatorUtcTimesAndMappedPayloads()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var catalog = await SeedCatalogAsync(baby);
        await As(baby, BabyRole.Parent).PostAsJsonAsync(ImportPath(baby.BabyId), Body(FullMappings(catalog)));
        var parentId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Parent));

        var events = await factory.QueryAsync(context => context.Events.Where(stored => stored.BabyId == baby.BabyId).ToListAsync());

        Assert.All(events, stored => Assert.Equal(parentId, stored.CreatedBy));
        var firstMedicine = events.Single(stored => stored.TypeId == BuiltInEventTypes.MedicationId && stored.StartedAt == new DateTimeOffset(2025, 9, 1, 14, 0, 0, TimeSpan.Zero) && stored.Payload.Value.Contains("Colidis", StringComparison.Ordinal));
        using var payload = JsonDocument.Parse(firstMedicine.Payload.Value);
        Assert.Equal(
            [catalog.ColidisId.ToString(), "Puravit"],
            payload.RootElement.GetProperty("medications").EnumerateArray().Select(item => item.GetProperty(item.GetProperty("name").GetString() == "Colidis" ? "medicationId" : "name").GetString()));
        var typoMedicine = events.Single(stored => stored.StartedAt == new DateTimeOffset(2025, 9, 2, 10, 0, 0, TimeSpan.Zero));
        Assert.Contains(catalog.FlygasId.ToString(), typoMedicine.Payload.Value, StringComparison.Ordinal);
        Assert.Contains(events, stored => stored.TypeId == BuiltInEventTypes.SleepId && stored.Payload.Value.Contains("\"bed_time\"", StringComparison.Ordinal) && stored.EndedAt == stored.StartedAt);
        Assert.Contains(events, stored => stored.TypeId == BuiltInEventTypes.FeedingId && stored.Notes == "Took it slowly, then burped");
    }

    [Fact]
    public async Task Import_SameFileTwice_SecondRunCreatesNothing()
    {
        var baby = await factory.SeedBabyAsync();
        var catalog = await SeedCatalogAsync(baby);
        var client = As(baby, BabyRole.Owner);
        await client.PostAsJsonAsync(ImportPath(baby.BabyId), Body(FullMappings(catalog)));

        var second = await (await client.PostAsJsonAsync(ImportPath(baby.BabyId), Body(FullMappings(catalog)))).ReadAsync<NapperImportResponse>();

        Assert.Equal((0, 0), (second.EventsCreated, second.MeasurementsCreated));
        Assert.Empty(second.CreatedMedications);
        Assert.Equal((17, 3), (second.Logs!.AlreadyImported, second.Measurements!.AlreadyImported));
        Assert.Equal((17, 3, 4), (await EventCountAsync(baby.BabyId), await MeasurementCountAsync(baby.BabyId), await MedicationCountAsync(baby.BabyId)));
    }

    [Fact]
    public async Task Import_AgainWithoutMappings_IsAcceptedBecauseNothingIsNew()
    {
        var baby = await factory.SeedBabyAsync();
        var catalog = await SeedCatalogAsync(baby);
        var client = As(baby, BabyRole.Owner);
        await client.PostAsJsonAsync(ImportPath(baby.BabyId), Body(FullMappings(catalog)));

        var second = await client.PostAsJsonAsync(ImportPath(baby.BabyId), Body());

        Assert.Equal(0, (await second.ReadAsync<NapperImportResponse>()).EventsCreated);
    }

    [Fact]
    public async Task Import_AfterDeletingAnImportedEvent_DoesNotResurrectIt()
    {
        var baby = await factory.SeedBabyAsync();
        var catalog = await SeedCatalogAsync(baby);
        var client = As(baby, BabyRole.Owner);
        await client.PostAsJsonAsync(ImportPath(baby.BabyId), Body(FullMappings(catalog)));
        var deletedId = await factory.QueryAsync(context => context.Events.Where(stored => stored.BabyId == baby.BabyId).Select(stored => stored.Id).FirstAsync());
        await client.DeleteAsync($"/api/v1/babies/{baby.BabyId}/events/{deletedId}");

        var second = await (await client.PostAsJsonAsync(ImportPath(baby.BabyId), Body(FullMappings(catalog)))).ReadAsync<NapperImportResponse>();

        Assert.Equal(0, second.EventsCreated);
        Assert.NotNull(await factory.QueryAsync(context => context.EventsIncludingDeleted.Where(stored => stored.Id == deletedId).Select(stored => stored.DeletedAt).SingleAsync()));
    }

    [Fact]
    public async Task Import_UnmappedMedications_Returns422ListingThemAndWritesNothing()
    {
        var baby = await factory.SeedBabyAsync();
        var catalog = await SeedCatalogAsync(baby);

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(
            ImportPath(baby.BabyId),
            Body([Existing("Colidis", catalog.ColidisId), Create("Puravit", "Puravit")]));

        var problem = await response.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "import_unmapped_medications");
        Assert.Equal(["Colicaliv", "flagas", "Flygas"], problem.GetProperty("tokens").EnumerateArray().Select(token => token.GetString()));
        Assert.Equal((0, 0, 2), (await EventCountAsync(baby.BabyId), await MeasurementCountAsync(baby.BabyId), await MedicationCountAsync(baby.BabyId)));
    }

    [Fact]
    public async Task Import_IgnoredMedications_AreLeftOutAndAllIgnoredRowsSkipped()
    {
        var baby = await factory.SeedBabyAsync();
        var ignoreAll = new[] { "Colidis", "Puravit", "Colicaliv", "Flagas", "Flygas" }.Select(token => (object)new { token, action = "ignore" }).ToArray();

        var imported = await (await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), Body(ignoreAll))).ReadAsync<NapperImportResponse>();

        Assert.Equal(13, imported.EventsCreated);
        Assert.Equal(4, imported.Logs!.SkippedRows.Count(skipped => skipped.Code == "medications_ignored"));
        Assert.Empty(imported.CreatedMedications);
    }

    [Fact]
    public async Task Import_MappingToAMedicationOutsideTheCatalog_Returns422()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), Body([Existing("Colidis", Guid.NewGuid())]));

        var problem = await response.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "import_invalid_medication_mapping");
        Assert.Equal("Colidis", problem.GetProperty("token").GetString());
    }

    [Fact]
    public async Task Import_UnknownMappingAction_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), Body([new { token = "Colidis", action = "guess" }]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Import_OnlyMeasurements_ImportsThemAndReportsNoLogs()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), new { measurementsCsv = MeasurementsCsv });

        var imported = await response.ReadAsync<NapperImportResponse>();
        Assert.Equal((0, 3), (imported.EventsCreated, imported.MeasurementsCreated));
        Assert.Null(imported.Logs);
    }

    [Fact]
    public async Task Import_PumpingAndBottleRows_StoreBreastPumpAmountsAndLowerCaseBottleContent()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), Body(logsCsv: Fixture("napper-pumping.csv"), measurementsCsv: string.Empty));

        var imported = await response.ReadAsync<NapperImportResponse>();
        Assert.Equal(3, imported.EventsCreated);
        Assert.Equal([(3, "invalid_record"), (5, "unknown_category")], imported.Logs!.SkippedRows.Select(skipped => (skipped.Row, skipped.Code)));
        Assert.Contains("amount_left_ml", imported.Logs.SkippedRows[0].Reason, StringComparison.Ordinal);
        Assert.Equal("breast_pump", imported.Logs.Categories.Single(category => category.Category == "BREAST_PUMP").EventTypeKey);
        var events = await factory.QueryAsync(context => context.Events.Where(stored => stored.BabyId == baby.BabyId).OrderBy(stored => stored.StartedAt).ToListAsync());
        Assert.Equal([BuiltInEventTypes.BreastPumpId, BuiltInEventTypes.BreastPumpId, BuiltInEventTypes.FeedingId], events.Select(stored => stored.TypeId));
        Assert.True(Domain.Events.EventPayload.From("""{"amount_left_ml":40,"amount_right_ml":35.5}""").IsEquivalentTo(events[0].Payload));
        Assert.Equal((TimeSpan.FromMinutes(15), "Morning session"), (events[0].Duration!.Value, events[0].Notes));
        Assert.True(Domain.Events.EventPayload.From("""{"amount_left_ml":20}""").IsEquivalentTo(events[1].Payload));
        Assert.Equal(events[1].StartedAt, events[1].EndedAt);
        Assert.True(Domain.Events.EventPayload.From("""{"method":"bottle","amount_ml":90,"bottle_feeding_type":"formula"}""").IsEquivalentTo(events[2].Payload));
    }

    [Fact]
    public async Task Import_TemperatureRows_StoreTheCelsiusValueAndSkipEmptyOrOutOfRangeOnes()
    {
        var baby = await factory.SeedBabyAsync();
        const string csv = "start,end,category,temperature,units,comment\n"
            + "2025-09-01T09:00:00Z,2025-09-01T09:00:00Z,TEMPERATURE,37.8,,Armpit\n"
            + "2025-09-01T10:00:00Z,2025-09-01T10:00:00Z,TEMPERATURE,100.4,FAHRENHEIT,\n"
            + "2025-09-01T11:00:00Z,2025-09-01T11:00:00Z,TEMPERATURE,,,\n"
            + "2025-09-01T12:00:00Z,2025-09-01T12:00:00Z,TEMPERATURE,98.6,,\n";

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), Body(logsCsv: csv, measurementsCsv: string.Empty));

        var imported = await response.ReadAsync<NapperImportResponse>();
        Assert.Equal(2, imported.EventsCreated);
        Assert.Equal([(3, "missing_value"), (4, "invalid_record")], imported.Logs!.SkippedRows.Select(skipped => (skipped.Row, skipped.Code)));
        Assert.Equal("temperature", imported.Logs.Categories.Single(category => category.Category == "TEMPERATURE").EventTypeKey);
        var events = await factory.QueryAsync(context => context.Events.Where(stored => stored.BabyId == baby.BabyId).OrderBy(stored => stored.StartedAt).ToListAsync());
        Assert.All(events, stored => Assert.Equal(BuiltInEventTypes.TemperatureId, stored.TypeId));
        Assert.True(Domain.Events.EventPayload.From("""{"value_c":37.8}""").IsEquivalentTo(events[0].Payload));
        Assert.True(Domain.Events.EventPayload.From("""{"value_c":38.0}""").IsEquivalentTo(events[1].Payload));
        Assert.Equal(("Armpit", events[0].StartedAt), (events[0].Notes, events[0].EndedAt!.Value));
    }

    [Fact]
    public async Task Import_CategoryOption_ImportsOnlyThoseCategories()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), Body(options: new { categories = new[] { "nap", "BED_TIME" } }));

        var imported = await response.ReadAsync<NapperImportResponse>();
        Assert.Equal(5, imported.EventsCreated);
        Assert.Contains(imported.Logs!.SkippedRows, skipped => skipped.Code == "excluded_category");
    }

    [Fact]
    public async Task Preview_NoFiles_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(PreviewPath(baby.BabyId), new { logsCsv = " " });

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task Preview_FileOverFiveMegabytes_Returns413()
    {
        var baby = await factory.SeedBabyAsync();
        var oversized = "start,end,category\n" + new string('x', NapperImportService.MaxFileBytes);

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(PreviewPath(baby.BabyId), new { logsCsv = oversized });

        var problem = await response.AssertProblemAsync(HttpStatusCode.RequestEntityTooLarge, "import_file_too_large");
        Assert.Equal("logsCsv", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Preview_MoreThanMaxRows_Returns400()
    {
        var baby = await factory.SeedBabyAsync();
        var csv = new StringBuilder("start,end,category\n");
        Enumerable.Range(0, NapperImportService.MaxRows + 1).ToList().ForEach(_ => csv.Append("x,x,NAP\n"));

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(PreviewPath(baby.BabyId), new { logsCsv = csv.ToString() });

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "import_too_many_rows");
    }

    [Fact]
    public async Task Preview_HostileFileWithTensOfThousandsOfMedicationNames_Returns400Quickly()
    {
        var baby = await factory.SeedBabyAsync();
        var csv = new StringBuilder("start,end,category,comment\n");
        Enumerable.Range(0, NapperImportService.MaxRows).ToList().ForEach(index => csv.Append(CultureInfo.InvariantCulture, $"2025-09-01T08:00:00Z,,MEDICINE,\"m{index}a, m{index}b, m{index}c\"\n"));
        var stopwatch = Stopwatch.StartNew();

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(PreviewPath(baby.BabyId), new { logsCsv = csv.ToString() });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "import_too_many_medication_names");
        Assert.Equal(500, problem.GetProperty("maxNames").GetInt32());
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(10), $"took {stopwatch.Elapsed}");
    }

    [Fact]
    public async Task Import_AfterRenamingAnImportedMedication_ReusesItWithoutConflict()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        const string firstRow = "2025-09-01T08:00:00Z,,MEDICINE,Puravit\n";
        var mappings = new[] { Create("Puravit", "Puravit") };
        var first = await (await client.PostAsJsonAsync(ImportPath(baby.BabyId), new { logsCsv = "start,end,category,comment\n" + firstRow, medicationMappings = mappings })).ReadAsync<NapperImportResponse>();
        var puravit = Assert.Single(first.CreatedMedications);
        await client.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/medications/{puravit.Id}", new { name = "Puravit gotas", isUsual = true });

        var response = await client.PostAsJsonAsync(
            ImportPath(baby.BabyId),
            new { logsCsv = "start,end,category,comment\n" + firstRow + "2025-09-02T08:00:00Z,,MEDICINE,Puravit\n", medicationMappings = mappings });

        var second = await response.ReadAsync<NapperImportResponse>();
        Assert.Equal((1, 0), (second.EventsCreated, second.CreatedMedications.Count));
        Assert.Equal(1, await MedicationCountAsync(baby.BabyId));
        var newEvent = await factory.QueryAsync(context => context.Events.SingleAsync(stored => stored.BabyId == baby.BabyId && stored.StartedAt == new DateTimeOffset(2025, 9, 2, 8, 0, 0, TimeSpan.Zero)));
        Assert.Contains(puravit.Id.ToString(), newEvent.Payload.Value, StringComparison.Ordinal);
        Assert.Contains("Puravit gotas", newEvent.Payload.Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Preview_MissingRequiredColumn_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(PreviewPath(baby.BabyId), new { logsCsv = "start,category\n2025-09-01T09:00:00Z,NAP\n" });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "import_invalid_file");
        Assert.Equal("logsCsv", problem.GetProperty("field").GetString());
    }

    [Theory]
    [InlineData("/import/napper/preview")]
    [InlineData("/import/napper")]
    public async Task Post_Viewer_Returns403AndWritesNothing(string path)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);

        var response = await As(baby, BabyRole.Viewer).PostAsJsonAsync($"/api/v1/babies/{baby.BabyId}{path}", Body());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await EventCountAsync(baby.BabyId));
    }

    [Theory]
    [InlineData("/import/napper/preview")]
    [InlineData("/import/napper")]
    public async Task Post_NonMember_Returns403(string path)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PostAsJsonAsync($"/api/v1/babies/{baby.BabyId}{path}", Body());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData("/import/napper/preview")]
    [InlineData("/import/napper")]
    public async Task Post_Anonymous_Returns401(string path)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().PostAsJsonAsync($"/api/v1/babies/{baby.BabyId}{path}", Body());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    private sealed record Catalog(Guid ColidisId, Guid FlygasId);
}
