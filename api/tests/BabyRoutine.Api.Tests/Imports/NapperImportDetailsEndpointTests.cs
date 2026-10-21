using System.Net;
using System.Net.Http.Json;
using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Application.Imports;
using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Api.Tests.Imports;

/// <summary>
/// Napper sleep details and pauses mapped to payload fields (fixture rows 3 and 18-21), and the
/// <c>options.enrichExisting</c> import that fills them into events imported before.
/// </summary>
public sealed class NapperImportDetailsEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string BareCsv = """
        start,end,category
        2025-09-01T13:00:00.000-03:00,2025-09-01T14:10:00.000-03:00,NAP
        2025-09-02T15:00:00.000-03:00,2025-09-02T15:30:00.000-03:00,NURSING
        """;

    private const string DetailedCsv = """
        start,end,category,babyMoodOnWakeUp,babyMoodOnSleep,breastLeftSeconds,breastRightSeconds,numberOfPauses,pausedMinutes,howBabySlept,howBabyWoke,timeToFallAsleep,comment
        2025-09-01T13:00:00.000-03:00,2025-09-01T14:10:00.000-03:00,NAP,GOOD,NEUTRAL,,,2,5.5,WORN_OR_HELD,WOKE_UP_NATURALLY,15,From Napper
        2025-09-02T15:00:00.000-03:00,2025-09-02T15:30:00.000-03:00,NURSING,,,600,600,1,3,,,,
        """;

    private static readonly DateTimeOffset NapStart = new(2025, 9, 1, 16, 0, 0, TimeSpan.Zero);

    private static string LogsFixture => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Imports", "Fixtures", "napper-logs.csv"));

    private static string PreviewPath(Guid babyId) => $"/api/v1/babies/{babyId}/import/napper/preview";

    private static string ImportPath(Guid babyId) => $"/api/v1/babies/{babyId}/import/napper";

    private static object Enrich(string logsCsv) => new { logsCsv, options = new { enrichExisting = true } };

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private Task<List<Event>> EventsAsync(Guid babyId) =>
        factory.QueryAsync(context => context.EventsIncludingDeleted.Where(stored => stored.BabyId == babyId).OrderBy(stored => stored.StartedAt).ToListAsync());

    private async Task<SeededBaby> SeedWithBareImportAsync()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);
        var imported = await (await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), new { logsCsv = BareCsv })).ReadAsync<NapperImportResponse>();
        Assert.Equal(2, imported.EventsCreated);
        return baby;
    }

    [Fact]
    public async Task Import_Fixture_StoresSleepDetailsAndPausesAsFields()
    {
        var baby = await factory.SeedBabyAsync();

        await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), new { logsCsv = LogsFixture, medicationMappings = IgnoreMedications() });

        var events = await EventsAsync(baby.BabyId);
        var heldNap = events.Single(stored => stored.StartedAt == NapStart);
        Assert.True(EventPayload.From("""{"kind":"nap","how_slept":"held","mood_on_wake":"good","how_woke":"naturally","time_to_fall_asleep_minutes":15,"pause_count":2,"paused_seconds":330}""").IsEquivalentTo(heldNap.Payload), heldNap.Payload.Value);
        Assert.Equal("Mood on sleep: NEUTRAL", heldNap.Notes);
        var carNap = events.Single(stored => stored.StartedAt == new DateTimeOffset(2025, 9, 1, 19, 0, 0, TimeSpan.Zero));
        Assert.True(EventPayload.From("""{"kind":"nap","how_slept":"car","mood_on_wake":"bad","how_woke":"woken","time_to_fall_asleep_minutes":10}""").IsEquivalentTo(carNap.Payload), carNap.Payload.Value);
        var nursing = events.Single(stored => stored.StartedAt == new DateTimeOffset(2025, 9, 2, 18, 0, 0, TimeSpan.Zero));
        Assert.True(EventPayload.From("""{"method":"breast","side":"both","breast_left_seconds":600,"breast_right_seconds":600,"pause_count":1,"paused_seconds":180}""").IsEquivalentTo(nursing.Payload), nursing.Payload.Value);
        Assert.Equal(TimeSpan.FromMinutes(27), EffectiveDuration.Of(nursing.StartedAt, nursing.EndedAt, nursing.Payload));
    }

    [Fact]
    public async Task Import_FixtureUnusableDetails_AreSkippedFieldsKeptInNotesNotSkippedRows()
    {
        var baby = await factory.SeedBabyAsync();

        var imported = await (await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), new { logsCsv = LogsFixture, medicationMappings = IgnoreMedications() })).ReadAsync<NapperImportResponse>();

        Assert.Equal(
            [(3, "babyMoodOnWakeUp", "HAPPY"), (20, "babyMoodOnWakeUp", "SLEEPY"), (20, "timeToFallAsleep", "abc"), (20, "numberOfPauses", "many"), (20, "pausedMinutes", "120")],
            imported.Logs!.SkippedFields.Select(skipped => (skipped.Row, skipped.Field, skipped.Value)));
        Assert.All(imported.Logs.SkippedFields, skipped => Assert.Equal(("NAP", "invalid_value"), (skipped.Category, skipped.Code)));
        Assert.DoesNotContain(imported.Logs.SkippedRows, skipped => skipped.Row is 3 or 20);
        var spaceship = (await EventsAsync(baby.BabyId)).Single(stored => stored.StartedAt == new DateTimeOffset(2025, 9, 2, 16, 0, 0, TimeSpan.Zero));
        Assert.True(EventPayload.From("""{"kind":"nap","how_slept":"other"}""").IsEquivalentTo(spaceship.Payload), spaceship.Payload.Value);
        Assert.Equal("How baby slept: SPACESHIP\nMood on wake-up: SLEEPY\nTime to fall asleep: abc\nPauses: many\nPaused minutes: 120", spaceship.Notes);
    }

    [Fact]
    public async Task Preview_Fixture_ReportsTheSameSkippedFieldsAsTheImport()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var body = new { logsCsv = LogsFixture, medicationMappings = IgnoreMedications() };

        var preview = await (await client.PostAsJsonAsync(PreviewPath(baby.BabyId), body)).ReadAsync<NapperImportPreviewResponse>();
        var imported = await (await client.PostAsJsonAsync(ImportPath(baby.BabyId), body)).ReadAsync<NapperImportResponse>();

        Assert.Equal(5, preview.Logs!.SkippedFields.Count);
        Assert.Equal(preview.Logs.SkippedFields, imported.Logs!.SkippedFields);
        Assert.Equal((0, 0), (preview.EventsEnriched, imported.EventsEnriched));
    }

    [Fact]
    public async Task Import_EnrichExisting_FillsOnlyMissingDetailFieldsAndKeepsTimesNotesAndType()
    {
        var baby = await SeedWithBareImportAsync();
        var before = await EventsAsync(baby.BabyId);

        var response = await As(baby, BabyRole.Parent).PostAsJsonAsync(ImportPath(baby.BabyId), Enrich(DetailedCsv));

        var imported = await response.ReadAsync<NapperImportResponse>();
        Assert.Equal((0, 2, 2), (imported.EventsCreated, imported.EventsEnriched, imported.Logs!.AlreadyImported));
        Assert.Equal(
            [("how_slept", 1), ("time_to_fall_asleep_minutes", 1), ("how_woke", 1), ("mood_on_wake", 1), ("pause_count", 2), ("paused_seconds", 2)],
            imported.EnrichedFields.Select(field => (field.Field, field.Count)));
        var after = await EventsAsync(baby.BabyId);
        Assert.Equal(before.Select(stored => (stored.Id, stored.TypeId, stored.StartedAt, stored.EndedAt, stored.Notes, stored.CreatedAt)), after.Select(stored => (stored.Id, stored.TypeId, stored.StartedAt, stored.EndedAt, stored.Notes, stored.CreatedAt)));
        Assert.True(EventPayload.From("""{"kind":"nap","how_slept":"held","time_to_fall_asleep_minutes":15,"how_woke":"naturally","mood_on_wake":"good","pause_count":2,"paused_seconds":330}""").IsEquivalentTo(after[0].Payload), after[0].Payload.Value);
        Assert.True(EventPayload.From("""{"method":"breast","pause_count":1,"paused_seconds":180}""").IsEquivalentTo(after[1].Payload), after[1].Payload.Value);
        Assert.All(after.Zip(before), pair => Assert.True(pair.First.UpdatedAt > pair.Second.UpdatedAt));
        Assert.All(after, stored => Assert.Equal(stored.UpdatedAt, stored.ClientUpdatedAt));
    }

    [Fact]
    public async Task Import_EnrichExisting_AppearsInTheDeltaPull()
    {
        var baby = await SeedWithBareImportAsync();
        var since = (await EventsAsync(baby.BabyId)).Max(stored => stored.UpdatedAt).AddTicks(10);
        await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), Enrich(DetailedCsv));

        var changes = await As(baby, BabyRole.Viewer).GetFromJsonAsync<List<Dictionary<string, object>>>($"/api/v1/babies/{baby.BabyId}/events?since={Uri.EscapeDataString(since.ToString("O"))}");

        Assert.Equal(2, changes!.Count);
    }

    [Fact]
    public async Task Import_EnrichExisting_NeverOverwritesAValueTheParentSet()
    {
        var baby = await SeedWithBareImportAsync();
        var nap = (await EventsAsync(baby.BabyId))[0];
        var edit = await As(baby, BabyRole.Parent).PutAsJsonAsync(
            $"/api/v1/babies/{baby.BabyId}/events/{nap.Id}",
            new { typeId = BuiltInEventTypes.SleepId, startedAt = nap.StartedAt, endedAt = nap.EndedAt, payload = new { kind = "nap", how_slept = "in_bed", pause_count = 1 } });
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);

        var imported = await (await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), Enrich(DetailedCsv))).ReadAsync<NapperImportResponse>();

        Assert.Equal(2, imported.EventsEnriched);
        var payload = (await EventsAsync(baby.BabyId))[0].Payload;
        Assert.Equal(("in_bed", "good"), (payload.GetString("how_slept"), payload.GetString("mood_on_wake")));
        Assert.Contains("\"pause_count\":1", payload.Value.Replace(" ", string.Empty, StringComparison.Ordinal), StringComparison.Ordinal);
        Assert.Equal(1, imported.EnrichedFields.Single(field => field.Field == "pause_count").Count);
        Assert.DoesNotContain(imported.EnrichedFields, field => field.Field == "how_slept");
    }

    [Fact]
    public async Task Import_EnrichExisting_LeavesSoftDeletedEventsUntouched()
    {
        var baby = await SeedWithBareImportAsync();
        var nap = (await EventsAsync(baby.BabyId))[0];
        await As(baby, BabyRole.Owner).DeleteAsync($"/api/v1/babies/{baby.BabyId}/events/{nap.Id}");
        var deleted = (await EventsAsync(baby.BabyId))[0];

        var imported = await (await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), Enrich(DetailedCsv))).ReadAsync<NapperImportResponse>();

        Assert.Equal((0, 1), (imported.EventsCreated, imported.EventsEnriched));
        var after = (await EventsAsync(baby.BabyId))[0];
        Assert.Equal((deleted.Payload.Value, deleted.UpdatedAt, deleted.DeletedAt), (after.Payload.Value, after.UpdatedAt, after.DeletedAt));
    }

    [Fact]
    public async Task Import_EnrichExistingTwice_SecondRunEnrichesNothing()
    {
        var baby = await SeedWithBareImportAsync();
        var client = As(baby, BabyRole.Owner);
        await client.PostAsJsonAsync(ImportPath(baby.BabyId), Enrich(DetailedCsv));
        var first = await EventsAsync(baby.BabyId);

        var second = await (await client.PostAsJsonAsync(ImportPath(baby.BabyId), Enrich(DetailedCsv))).ReadAsync<NapperImportResponse>();

        Assert.Equal((0, 0), (second.EventsCreated, second.EventsEnriched));
        Assert.Empty(second.EnrichedFields);
        Assert.Equal(first.Select(stored => stored.UpdatedAt), (await EventsAsync(baby.BabyId)).Select(stored => stored.UpdatedAt));
    }

    [Fact]
    public async Task Preview_EnrichExisting_ReportsWhatTheImportEnrichesAndWritesNothing()
    {
        var baby = await SeedWithBareImportAsync();
        var client = As(baby, BabyRole.Owner);
        var before = await EventsAsync(baby.BabyId);

        var preview = await (await client.PostAsJsonAsync(PreviewPath(baby.BabyId), Enrich(DetailedCsv))).ReadAsync<NapperImportPreviewResponse>();

        Assert.Equal(before.Select(stored => (stored.Payload.Value, stored.UpdatedAt)), (await EventsAsync(baby.BabyId)).Select(stored => (stored.Payload.Value, stored.UpdatedAt)));
        var imported = await (await client.PostAsJsonAsync(ImportPath(baby.BabyId), Enrich(DetailedCsv))).ReadAsync<NapperImportResponse>();
        Assert.Equal(2, preview.EventsEnriched);
        Assert.Equal(preview.EventsEnriched, imported.EventsEnriched);
        Assert.Equal(preview.EnrichedFields, imported.EnrichedFields);
    }

    [Fact]
    public async Task Import_WithoutEnrichExisting_LeavesImportedEventsAlone()
    {
        var baby = await SeedWithBareImportAsync();
        var before = await EventsAsync(baby.BabyId);

        var imported = await (await As(baby, BabyRole.Owner).PostAsJsonAsync(ImportPath(baby.BabyId), new { logsCsv = DetailedCsv })).ReadAsync<NapperImportResponse>();

        Assert.Equal((0, 0, 2), (imported.EventsCreated, imported.EventsEnriched, imported.Logs!.AlreadyImported));
        Assert.Equal(before.Select(stored => (stored.Payload.Value, stored.UpdatedAt)), (await EventsAsync(baby.BabyId)).Select(stored => (stored.Payload.Value, stored.UpdatedAt)));
    }

    [Theory]
    [InlineData("/import/napper/preview")]
    [InlineData("/import/napper")]
    public async Task EnrichExisting_Viewer_Returns403AndChangesNothing(string path)
    {
        var baby = await SeedWithBareImportAsync();
        var before = await EventsAsync(baby.BabyId);

        var response = await As(baby, BabyRole.Viewer).PostAsJsonAsync($"/api/v1/babies/{baby.BabyId}{path}", Enrich(DetailedCsv));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(before.Select(stored => stored.Payload.Value), (await EventsAsync(baby.BabyId)).Select(stored => stored.Payload.Value));
    }

    [Fact]
    public async Task EnrichExisting_OtherBabysImport_IsNotTouched()
    {
        var baby = await SeedWithBareImportAsync();
        var other = await factory.SeedBabyAsync();

        var imported = await (await As(other, BabyRole.Owner).PostAsJsonAsync(ImportPath(other.BabyId), Enrich(DetailedCsv))).ReadAsync<NapperImportResponse>();

        Assert.Equal((2, 0), (imported.EventsCreated, imported.EventsEnriched));
        Assert.All(await EventsAsync(baby.BabyId), stored => Assert.DoesNotContain("pause_count", stored.Payload.Value, StringComparison.Ordinal));
    }

    private static object[] IgnoreMedications() =>
        new[] { "Colidis", "Puravit", "Colicaliv", "Flagas", "Flygas" }.Select(token => (object)new { token, action = "ignore" }).ToArray();
}
