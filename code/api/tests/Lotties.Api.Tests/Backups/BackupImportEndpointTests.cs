using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Lotties.Api.Tests.Support;
using Lotties.Application.Backups;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Backups;

public sealed partial class BackupImportEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly string[] Sections = ["event-types", "medications", "prescriptions", "formulas", "care-providers", "appointments", "vaccinations", "measurements", "notes"];

    [GeneratedRegex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")]
    private static partial Regex GuidPattern();

    private static readonly string[] Volatile =
    [
        "id", "babyId", "createdBy", "createdAt", "updatedAt", "clientUpdatedAt", "authorUserId", "author", "prescribedByUserId", "prescribedBy", "recordedBy", "deletedAt",
    ];

    /// <summary>Every list of the baby as the app reads it, without ids, authors and server times, so two babies can be compared.</summary>
    private static async Task<Dictionary<string, string[]>> SnapshotAsync(HttpClient client, Guid babyId)
    {
        var snapshot = new Dictionary<string, string[]>();
        foreach (var section in Sections)
        {
            snapshot[section] = await ProjectAsync(client, $"{BackupFixture.BabyPath(babyId)}/{section}", section == "event-types");
        }

        snapshot["events"] = await ProjectAsync(client, $"{BackupFixture.BabyPath(babyId)}/events?limit=500", onlyCustom: false);
        return snapshot;
    }

    private static async Task<string[]> ProjectAsync(HttpClient client, string path, bool onlyCustom)
    {
        var items = (await (await client.GetAsync(path).Ok()).Content.ReadFromJsonAsync<JsonArray>())!;
        return items
            .OfType<JsonObject>()
            .Where(item => !onlyCustom || item["babyId"] is not null)
            .Select(item => Normalize(item))
            .Order(StringComparer.Ordinal)
            .ToArray();
    }

    private static string Normalize(JsonObject item)
    {
        var copy = (JsonObject)item.DeepClone();
        var deleted = copy["deletedAt"] is not null;
        Volatile.ToList().ForEach(name => copy.Remove(name));
        copy["deleted"] = deleted;
        return GuidPattern().Replace(copy.ToJsonString(), "<id>");
    }

    private static async Task<BackupImportReport> ReportAsync(HttpResponseMessage response) =>
        (await (await response.Ok()).Content.ReadFromJsonAsync<BackupImportReport>())!;

    private async Task<int> CountAsync(Guid babyId) =>
        await factory.QueryAsync(context => context.EventsIncludingDeleted.CountAsync(stored => stored.BabyId == babyId));

    private async Task<int> BabiesOfAsync(string subject)
    {
        var userId = await factory.UserIdAsync(subject);
        return await factory.QueryAsync(context => context.BabyMembers.CountAsync(member => member.UserId == userId));
    }

    [Fact]
    public async Task Restore_IntoANewBaby_ReproducesEveryRecordOfTheOriginal()
    {
        var rich = await factory.SeedRichBabyAsync();
        var text = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);
        var restorer = factory.NewUser();

        var report = await ReportAsync(await restorer.Restore(text));

        Assert.True(report.Applied);
        Assert.Equal("restore", report.Mode);
        Assert.NotEqual(rich.Baby.BabyId, report.BabyId);
        Assert.False(report.BabyExists);
        Assert.Equal(0, report.IssueCount);
        Assert.All(report.Kinds.Values, kinds => Assert.Equal((kinds.Total, 0, 0, 0, 0), (kinds.New, kinds.Unchanged, kinds.Updated, kinds.Kept, kinds.Invalid)));
        Assert.Equal(5, report.Kinds["events"].Total);
        var original = await SnapshotAsync(rich.Owner, rich.Baby.BabyId);
        var restored = await SnapshotAsync(restorer, report.BabyId);
        foreach (var (section, expected) in original)
        {
            Assert.Equal(expected, restored[section]);
        }

        var babies = await (await restorer.GetAsync("/api/v1/babies").Ok()).Content.ReadFromJsonAsync<JsonArray>();
        var restoredBaby = babies!.OfType<JsonObject>().Single();
        Assert.Equal(("Lia", "Owner", "public+private", 36, "yes"), ((string?)restoredBaby["name"], (string?)restoredBaby["role"], (string?)restoredBaby["vaccineProfile"], (int?)restoredBaby["gestationalAgeWeeks"], (string?)restoredBaby["rsvMaternalVaccination"]));
        Assert.Equal(report.BabyId, (Guid)restoredBaby["id"]!);
    }

    [Fact]
    public async Task Restore_RemapsTheReferencesInsideEventsAndRecords()
    {
        var rich = await factory.SeedRichBabyAsync();
        var text = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);
        var restorer = factory.NewUser();

        var report = await ReportAsync(await restorer.Restore(text));

        var path = BackupFixture.BabyPath(report.BabyId);
        var medication = (await (await restorer.GetAsync($"{path}/medications").Ok()).Content.ReadFromJsonAsync<JsonArray>())!.OfType<JsonObject>().Single(item => (string?)item["name"] == "Colidis");
        var prescription = (await (await restorer.GetAsync($"{path}/prescriptions").Ok()).Content.ReadFromJsonAsync<JsonArray>())!.OfType<JsonObject>().Single(item => item["deletedAt"] is null);
        var formula = (await (await restorer.GetAsync($"{path}/formulas").Ok()).Content.ReadFromJsonAsync<JsonArray>())!.OfType<JsonObject>().Single(item => (string?)item["name"] == "Aptamil 2");
        var provider = (await (await restorer.GetAsync($"{path}/care-providers").Ok()).Content.ReadFromJsonAsync<JsonArray>())!.OfType<JsonObject>().Single(item => (string?)item["name"] == "Dr. Ana Lima");
        var appointment = (await (await restorer.GetAsync($"{path}/appointments").Ok()).Content.ReadFromJsonAsync<JsonArray>())!.OfType<JsonObject>().Single();
        var customType = (await (await restorer.GetAsync($"{path}/event-types").Ok()).Content.ReadFromJsonAsync<JsonArray>())!.OfType<JsonObject>().Single(item => (string?)item["key"] == "pump");
        var events = (await (await restorer.GetAsync($"{path}/events?limit=500").Ok()).Content.ReadFromJsonAsync<JsonArray>())!.OfType<JsonObject>().ToArray();

        Assert.NotEqual(rich.MedicationId, (Guid)medication["id"]!);
        Assert.Equal((Guid)medication["id"]!, (Guid)prescription["medicationId"]!);
        Assert.Equal((Guid)provider["id"]!, (Guid)appointment["providerId"]!);
        var bottle = events.Single(item => item["payload"]?["formula_id"] is not null);
        Assert.Equal((Guid)formula["id"]!, (Guid)bottle["payload"]!["formula_id"]!);
        var dose = events.Single(item => (Guid)item["typeId"]! == BuiltInEventTypes.MedicationId)["payload"]!["medications"]![0]!;
        Assert.Equal(((Guid)medication["id"]!, (Guid)prescription["id"]!), ((Guid)dose["medicationId"]!, (Guid)dose["prescriptionId"]!));
        Assert.Equal((Guid)customType["id"]!, (Guid)events.Single(item => (string?)item["notes"] == "custom")["typeId"]!);
        Assert.NotEqual(rich.CustomTypeId, (Guid)customType["id"]!);
        Assert.All(events, item => Assert.NotEqual(rich.BottleEventId, (Guid)item["id"]!));
    }

    [Fact]
    public async Task Restore_KeepsTheFussyOutcomeAndSuggestedCause()
    {
        var baby = await factory.SeedBabyAsync();
        var owner = factory.As(baby, BabyRole.Owner);
        await owner.PutAsJsonAsync(
            $"{BackupFixture.BabyPath(baby.BabyId)}/events/{Guid.NewGuid()}",
            new { typeId = BuiltInEventTypes.FussyId, startedAt = BackupFixture.Start, endedAt = BackupFixture.Start.AddMinutes(10), payload = new { intensity = "moderate", what_helped = "burping", suggested_cause = "gas" } }).Ok();
        var text = await owner.ExportTextAsync(baby.BabyId);
        var restorer = factory.NewUser();

        var report = await ReportAsync(await restorer.Restore(text));

        Assert.Equal(0, report.IssueCount);
        var events = (await (await restorer.GetAsync($"{BackupFixture.BabyPath(report.BabyId)}/events?limit=500").Ok()).Content.ReadFromJsonAsync<JsonArray>())!.OfType<JsonObject>();
        var payload = events.Single(item => (Guid)item["typeId"]! == BuiltInEventTypes.FussyId)["payload"]!;
        Assert.Equal(("moderate", "burping", "gas"), ((string?)payload["intensity"], (string?)payload["what_helped"], (string?)payload["suggested_cause"]));
    }

    [Fact]
    public async Task Restore_KeepsTheBottleSegments()
    {
        var baby = await factory.SeedBabyAsync();
        var owner = factory.As(baby, BabyRole.Owner);
        await owner.PutAsJsonAsync(
            $"{BackupFixture.BabyPath(baby.BabyId)}/events/{Guid.NewGuid()}",
            new { typeId = BuiltInEventTypes.FeedingId, startedAt = BackupFixture.Start, endedAt = BackupFixture.Start.AddMinutes(12), payload = new { method = "bottle", amount_ml = 120, amount_drunk_ml = 90, pause_count = 1, paused_seconds = 60, segments = "120>60@300;60>30@360" } }).Ok();
        var text = await owner.ExportTextAsync(baby.BabyId);
        var restorer = factory.NewUser();

        var report = await ReportAsync(await restorer.Restore(text));

        Assert.Equal(0, report.IssueCount);
        var events = (await (await restorer.GetAsync($"{BackupFixture.BabyPath(report.BabyId)}/events?limit=500").Ok()).Content.ReadFromJsonAsync<JsonArray>())!.OfType<JsonObject>();
        var payload = events.Single(item => (Guid)item["typeId"]! == BuiltInEventTypes.FeedingId && (string?)item["payload"]!["segments"] is not null)["payload"]!;
        Assert.Equal(("120>60@300;60>30@360", 90d), ((string?)payload["segments"], (double)payload["amount_drunk_ml"]!));
    }

    [Fact]
    public async Task Restore_MakesTheImporterTheOnlyMemberAndTheAuthorOfEverything()
    {
        var rich = await factory.SeedRichBabyAsync();
        var text = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);
        var subject = TestUsers.NewSubject();
        var restorer = factory.CreateClientFor(subject, "Restorer");

        var report = await ReportAsync(await restorer.Restore(text));

        var userId = await factory.UserIdAsync(subject);
        var members = await factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == report.BabyId).ToListAsync());
        Assert.Equal([(userId, BabyRole.Owner)], members.Select(member => (member.UserId, member.Role)));
        var authors = await factory.QueryAsync(context => context.EventsIncludingDeleted.Where(stored => stored.BabyId == report.BabyId).Select(stored => stored.CreatedBy).Distinct().ToListAsync());
        Assert.Equal([userId], authors);
        Assert.Contains(report.Notices, notice => notice.Code == "authors_remapped");
        Assert.Equal(0, await factory.QueryAsync(context => context.Invites.CountAsync(invite => invite.BabyId == report.BabyId)));
    }

    [Fact]
    public async Task Restore_SameFileTwice_ChangesNothing()
    {
        var rich = await factory.SeedRichBabyAsync();
        var text = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);
        var subject = TestUsers.NewSubject();
        var restorer = factory.CreateClientFor(subject, "Restorer");
        var first = await ReportAsync(await restorer.Restore(text));
        var before = await SnapshotAsync(restorer, first.BabyId);
        var events = await CountAsync(first.BabyId);

        var second = await ReportAsync(await restorer.Restore(text));

        Assert.Equal(first.BabyId, second.BabyId);
        Assert.True(second.BabyExists);
        Assert.All(second.Kinds.Values, kinds => Assert.Equal((0, 0, 0), (kinds.New, kinds.Updated, kinds.Invalid)));
        Assert.Equal(first.Kinds.ToDictionary(kind => kind.Key, kind => kind.Value.Total), second.Kinds.ToDictionary(kind => kind.Key, kind => kind.Value.Unchanged));
        Assert.Equal(events, await CountAsync(first.BabyId));
        Assert.Equal(1, await BabiesOfAsync(subject));
        var after = await SnapshotAsync(restorer, first.BabyId);
        Assert.Equal(before, after);
    }

    [Fact]
    public async Task Restore_ByTwoUsers_GivesEachHerOwnBabyWithoutCollidingIds()
    {
        var rich = await factory.SeedRichBabyAsync();
        var text = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);

        var first = await ReportAsync(await factory.NewUser("One").Restore(text));
        var second = await ReportAsync(await factory.NewUser("Two").Restore(text));

        Assert.NotEqual(first.BabyId, second.BabyId);
        Assert.Equal(await CountAsync(first.BabyId), await CountAsync(second.BabyId));
    }

    [Fact]
    public async Task Preview_WritesNothing_AndReportsWhatTheImportThenDoes()
    {
        var rich = await factory.SeedRichBabyAsync();
        var text = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);
        var subject = TestUsers.NewSubject();
        var restorer = factory.CreateClientFor(subject, "Restorer");

        var preview = await ReportAsync(await restorer.Restore(text, preview: true));

        Assert.False(preview.Applied);
        Assert.True(preview.CanImport);
        Assert.Equal(0, await BabiesOfAsync(subject));
        Assert.Equal(0, await CountAsync(preview.BabyId));
        var imported = await ReportAsync(await restorer.Restore(text));
        Assert.Equal(preview.BabyId, imported.BabyId);
        Assert.Equal(preview.Kinds, imported.Kinds);
        Assert.Equal(preview.Notices, imported.Notices);
    }

    [Fact]
    public async Task Merge_IntoTheBabyItCameFrom_IsANoOpThatKeepsTheIds()
    {
        var rich = await factory.SeedRichBabyAsync();
        var text = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);
        var before = await SnapshotAsync(rich.Owner, rich.Baby.BabyId);
        var events = await CountAsync(rich.Baby.BabyId);

        var report = await ReportAsync(await rich.Owner.Merge(rich.Baby.BabyId, text));

        Assert.True(report.Applied);
        Assert.Equal("merge", report.Mode);
        Assert.Equal(rich.Baby.BabyId, report.BabyId);
        Assert.All(report.Kinds.Values, kinds => Assert.Equal((0, 0, 0), (kinds.New, kinds.Updated, kinds.Invalid)));
        Assert.Equal(1, report.Kinds["notes"].Kept);
        Assert.Equal(events, await CountAsync(rich.Baby.BabyId));
        Assert.Equal(before, await SnapshotAsync(rich.Owner, rich.Baby.BabyId));
        Assert.Equal(1, await factory.QueryAsync(context => context.EventsIncludingDeleted.CountAsync(stored => stored.Id == rich.BottleEventId)));
    }

    [Fact]
    public async Task Merge_IntoAnotherBaby_AddsTheRecordsWithDerivedIdsAndKeepsWhatIsThere()
    {
        var rich = await factory.SeedRichBabyAsync();
        var text = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);
        var other = await factory.SeedBabyAsync(BabyRole.Parent);
        var owner = factory.As(other, BabyRole.Owner);
        var existingEvent = Guid.NewGuid();
        await owner.PutAsJsonAsync($"{BackupFixture.BabyPath(other.BabyId)}/events/{existingEvent}", new { typeId = BuiltInEventTypes.BathId, startedAt = BackupFixture.Start, payload = new { } }).Ok();

        var first = await ReportAsync(await owner.Merge(other.BabyId, text));
        var second = await ReportAsync(await factory.As(other, BabyRole.Parent).Merge(other.BabyId, text));

        Assert.Equal(5, first.Kinds["events"].New);
        Assert.All(second.Kinds.Values, kinds => Assert.Equal((0, 0, 0), (kinds.New, kinds.Updated, kinds.Invalid)));
        Assert.Equal(1 + 5, await CountAsync(other.BabyId));
        Assert.Equal(1, await factory.QueryAsync(context => context.EventsIncludingDeleted.CountAsync(stored => stored.Id == existingEvent && stored.BabyId == other.BabyId)));
        Assert.Equal(0, await factory.QueryAsync(context => context.EventsIncludingDeleted.CountAsync(stored => stored.Id == rich.BottleEventId && stored.BabyId == other.BabyId)));
        Assert.Equal("Lia", (await (await owner.GetAsync(BackupFixture.BabyPath(other.BabyId)).Ok()).Content.ReadFromJsonAsync<JsonObject>())!["name"]!.ToString());
    }

    [Fact]
    public async Task Merge_AppliesTheSyncRules_NewerCopyWinsAndNothingIsDeleted()
    {
        var rich = await factory.SeedRichBabyAsync();
        var firstFile = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);
        var target = factory.NewUser("Target");
        var restored = await ReportAsync(await target.Restore(firstFile));
        var path = BackupFixture.BabyPath(rich.Baby.BabyId);
        var later = DateTimeOffset.UtcNow.AddMinutes(1);
        await rich.Owner.PutAsJsonAsync(
            $"{path}/events/{rich.BottleEventId}",
            new { typeId = BuiltInEventTypes.FeedingId, startedAt = BackupFixture.Start, endedAt = BackupFixture.Start.AddMinutes(20), payload = new { method = "bottle", amount_ml = 150, amount_drunk_ml = 100, bottle_feeding_type = "formula", formula_id = rich.FormulaId, formula_name = "Aptamil 2" }, notes = "edited later", updatedAt = later }).Ok();
        await rich.Owner.DeleteAsync($"{path}/events/{rich.MedicationEventId}").Ok();
        var secondFile = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);

        var report = await ReportAsync(await target.Merge(restored.BabyId, secondFile));

        Assert.Equal((0, 1, 1, 3), (report.Kinds["events"].New, report.Kinds["events"].Updated, report.Kinds["events"].Kept, report.Kinds["events"].Unchanged));
        var events = (await (await target.GetAsync($"{BackupFixture.BabyPath(restored.BabyId)}/events?limit=500").Ok()).Content.ReadFromJsonAsync<JsonArray>())!.OfType<JsonObject>().ToArray();
        Assert.Equal("edited later", events.Single(item => item["payload"]?["formula_id"] is not null)["notes"]!.ToString());
        Assert.Equal(1, events.Count(item => (Guid)item["typeId"]! == BuiltInEventTypes.MedicationId && item["deletedAt"] is null));
    }

    [Fact]
    public async Task Merge_AnOlderFile_NeverOverwritesANewerEdit()
    {
        var rich = await factory.SeedRichBabyAsync();
        var oldFile = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);
        var path = BackupFixture.BabyPath(rich.Baby.BabyId);
        await rich.Owner.PutAsJsonAsync(
            $"{path}/events/{rich.BottleEventId}",
            new { typeId = BuiltInEventTypes.FeedingId, startedAt = BackupFixture.Start, endedAt = BackupFixture.Start.AddMinutes(20), payload = new { method = "bottle", amount_ml = 150, amount_drunk_ml = 100, bottle_feeding_type = "formula", formula_id = rich.FormulaId, formula_name = "Aptamil 2" }, notes = "newer edit", updatedAt = DateTimeOffset.UtcNow }).Ok();

        var report = await ReportAsync(await rich.Owner.Merge(rich.Baby.BabyId, oldFile));

        Assert.Equal((0, 1), (report.Kinds["events"].Updated, report.Kinds["events"].Kept));
        var stored = await (await rich.Owner.GetAsync($"{path}/events/{rich.BottleEventId}").Ok()).Content.ReadFromJsonAsync<JsonObject>();
        Assert.Equal("newer edit", stored!["notes"]!.ToString());
    }

    [Fact]
    public async Task Merge_Preview_ReportsWithoutWriting()
    {
        var rich = await factory.SeedRichBabyAsync();
        var text = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);
        var other = await factory.SeedBabyAsync();
        var owner = factory.As(other, BabyRole.Owner);

        var preview = await ReportAsync(await owner.Merge(other.BabyId, text, preview: true));

        Assert.False(preview.Applied);
        Assert.Equal(5, preview.Kinds["events"].New);
        Assert.Equal(0, await CountAsync(other.BabyId));
        Assert.Equal(0, await factory.QueryAsync(context => context.Medications.CountAsync(medication => medication.BabyId == other.BabyId)));
    }

    [Theory]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Doctor)]
    public async Task Merge_ByOtherRoles_Returns403(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor);

        var response = await factory.As(baby, role).Merge(baby.BabyId, "{}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Restore_ManyEvents_RoundTripsThousandsOfThem()
    {
        var baby = await factory.SeedBabyAsync();
        var owner = factory.As(baby, BabyRole.Owner);
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var now = DateTimeOffset.UtcNow;
        const int total = 2_500;
        await factory.SeedAsync(context =>
        {
            for (var index = 0; index < total; index++)
            {
                context.Events.Add(Lotties.Domain.Events.Event.Create(Guid.NewGuid(), baby.BabyId, BuiltInEventTypes.BathId, ownerId, now.AddMinutes(-index), null, Lotties.Domain.Events.EventPayload.Empty, null, now));
            }

            return Task.CompletedTask;
        });
        var text = await owner.ExportTextAsync(baby.BabyId);
        var restorer = factory.NewUser();

        var compressed = BackupFixture.Gzip(System.Text.Encoding.UTF8.GetBytes(text));

        var report = await ReportAsync(await restorer.PostAsync("/api/v1/babies/import", BackupFixture.Body(compressed)));

        Assert.True(compressed.Length < text.Length / 4);
        Assert.Equal((total, total), (report.Kinds["events"].Total, report.Kinds["events"].New));
        Assert.Equal(total, await CountAsync(report.BabyId));
    }
}
