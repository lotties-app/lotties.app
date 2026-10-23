using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Backups;
using Lotties.Application.Medications;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Backups;

/// <summary>A backup is not trusted: wrong versions, damaged or forged content, oversize files and files that name other babies are refused.</summary>
public sealed class BackupHostileFileTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<(RichBaby Rich, string Text)> ExportedAsync()
    {
        var rich = await factory.SeedRichBabyAsync();
        return (rich, await rich.Owner.ExportTextAsync(rich.Baby.BabyId));
    }

    private static async Task<JsonElement> AssertCodeAsync(HttpResponseMessage response, HttpStatusCode status, string code) =>
        await response.AssertProblemAsync(status, code);

    [Theory]
    [InlineData("")]
    [InlineData("not json at all")]
    [InlineData("[1,2,3]")]
    [InlineData("{}")]
    [InlineData("{\"format\":\"something-else\",\"schemaVersion\":1}")]
    public async Task Restore_NotABackup_Returns400(string body)
    {
        var response = await factory.NewUser().Restore(body);

        await AssertCodeAsync(response, HttpStatusCode.BadRequest, "backup_invalid_file");
    }

    [Fact]
    public async Task Restore_TruncatedFile_Returns400()
    {
        var (_, text) = await ExportedAsync();

        var response = await factory.NewUser().Restore(text[..(text.Length / 2)]);

        await AssertCodeAsync(response, HttpStatusCode.BadRequest, "backup_invalid_file");
    }

    [Fact]
    public async Task Restore_BrokenGzip_Returns400()
    {
        var response = await factory.NewUser().PostAsync("/api/v1/babies/import", BackupFixture.Body([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03]));

        await AssertCodeAsync(response, HttpStatusCode.BadRequest, "backup_invalid_file");
    }

    [Fact]
    public async Task Restore_FutureSchemaVersion_IsRefusedWithAClearMessage()
    {
        var (_, text) = await ExportedAsync();
        var future = text.Replace("\"schemaVersion\": 1", "\"schemaVersion\": 2", StringComparison.Ordinal);

        var problem = await AssertCodeAsync(await factory.NewUser().Restore(future), HttpStatusCode.UnprocessableEntity, "backup_unsupported_version");

        Assert.Equal((2, 1), (problem.GetProperty("schemaVersion").GetInt32(), problem.GetProperty("maxSupported").GetInt32()));
        Assert.Contains("Update the app", problem.GetProperty("detail").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Restore_EditedContent_FailsTheChecksum()
    {
        var (_, text) = await ExportedAsync();
        var edited = text.Replace("Offer 120 ml every 3 hours.", "Offer 999 ml every 3 hours.", StringComparison.Ordinal);

        var response = await factory.NewUser().Restore(edited);

        await AssertCodeAsync(response, HttpStatusCode.UnprocessableEntity, "backup_checksum_mismatch");
    }

    [Fact]
    public async Task Restore_ARecordRemovedFromTheFile_IsDetected()
    {
        var (_, text) = await ExportedAsync();
        var file = BackupFixture.Parse(text);
        var cut = file with { Events = file.Events!.Skip(1).ToArray() };

        var response = await factory.NewUser().Restore(JsonSerializer.Serialize(cut, BackupJson.Options));

        await AssertCodeAsync(response, HttpStatusCode.BadRequest, "backup_invalid_file");
    }

    [Fact]
    public async Task Restore_NoChecksum_IsRefused()
    {
        var (_, text) = await ExportedAsync();
        var file = BackupFixture.Parse(text) with { Checksum = null };

        var response = await factory.NewUser().Restore(JsonSerializer.Serialize(file, BackupJson.Options));

        await AssertCodeAsync(response, HttpStatusCode.BadRequest, "backup_invalid_file");
    }

    [Fact]
    public async Task Restore_ARecordOfAnotherBaby_IsRefused()
    {
        var (_, text) = await ExportedAsync();
        var file = BackupFixture.Parse(text);
        var forged = file with { Events = file.Events!.Select((stored, index) => index == 0 ? stored with { BabyId = Guid.NewGuid() } : stored).ToArray() };

        var response = await factory.NewUser().Restore(BackupFixture.Seal(forged));

        await AssertCodeAsync(response, HttpStatusCode.BadRequest, "backup_invalid_file");
    }

    [Fact]
    public async Task Restore_DuplicateIds_AreRefused()
    {
        var (_, text) = await ExportedAsync();
        var file = BackupFixture.Parse(text);
        var forged = file with { Events = [file.Events![0], file.Events[0]] };

        var response = await factory.NewUser().Restore(BackupFixture.Seal(forged));

        await AssertCodeAsync(response, HttpStatusCode.BadRequest, "backup_invalid_file");
    }

    [Fact]
    public async Task Restore_DecompressionBomb_Returns413()
    {
        var bomb = BackupFixture.Gzip(new byte[100 * 1024 * 1024]);

        var response = await factory.NewUser().PostAsync("/api/v1/babies/import", BackupFixture.Body(bomb));

        Assert.True(bomb.Length < 1024 * 1024);
        await AssertCodeAsync(response, HttpStatusCode.RequestEntityTooLarge, "backup_too_large");
    }

    [Fact]
    public async Task Restore_TooManyRecordsOfOneKind_Returns413()
    {
        var (_, text) = await ExportedAsync();
        var file = BackupFixture.Parse(text);
        var template = file.Medications![0];
        var forged = file with { Medications = Enumerable.Range(0, BackupReader.MaxOtherRecords + 1).Select(_ => template with { Id = Guid.NewGuid() }).ToArray() };

        var response = await factory.NewUser().Restore(BackupFixture.Seal(forged));

        await AssertCodeAsync(response, HttpStatusCode.RequestEntityTooLarge, "backup_too_large");
    }

    [Fact]
    public async Task Import_InvalidRecords_AreListedByThePreviewAndRefusedByTheImportWithNothingWritten()
    {
        var (_, text) = await ExportedAsync();
        var file = BackupFixture.Parse(text);
        var badEvent = file.Events![0] with { Id = Guid.NewGuid(), TypeId = Guid.NewGuid() };
        var badWeight = file.Measurements![0] with { Id = Guid.NewGuid(), WeightKg = 900m };
        var bigPayload = file.Events[1] with { Id = Guid.NewGuid(), Payload = JsonSerializer.SerializeToElement(new { text = new string('x', 20_000) }) };
        var forged = BackupFixture.Seal(file with { Events = [.. file.Events, badEvent, bigPayload], Measurements = [.. file.Measurements, badWeight] });
        var subject = TestUsers.NewSubject();
        var restorer = factory.CreateClientFor(subject, "Restorer");

        var preview = await (await restorer.Restore(forged, preview: true).Ok()).Content.ReadFromJsonAsync<BackupImportReport>();
        var refused = await restorer.Restore(forged);

        Assert.False(preview!.CanImport);
        Assert.Equal(3, preview.IssueCount);
        Assert.Equal(["event_type_not_available", "validation_failed"], preview.Issues.Where(issue => issue.Kind == "events").Select(issue => issue.Code).Order());
        Assert.Contains(preview.Issues, issue => issue is { Kind: "measurements", Code: "validation_failed", Field: "WeightKg" });
        Assert.Equal((2, 1), (preview.Kinds["events"].Invalid, preview.Kinds["measurements"].Invalid));
        var problem = await AssertCodeAsync(refused, HttpStatusCode.UnprocessableEntity, "backup_rejected");
        Assert.Equal(3, problem.GetProperty("issueCount").GetInt32());
        var userId = await factory.UserIdAsync(subject);
        Assert.Equal(0, await factory.QueryAsync(context => context.BabyMembers.CountAsync(member => member.UserId == userId)));
    }

    [Fact]
    public async Task Merge_AFileClaimingTheIdsOfAnotherBabysRecords_NeverTouchesThatBaby()
    {
        var victim = await factory.SeedRichBabyAsync();
        var attackerBaby = await factory.SeedBabyAsync();
        var attacker = factory.As(attackerBaby, BabyRole.Owner);
        var victimText = await victim.Owner.ExportTextAsync(victim.Baby.BabyId);
        var file = BackupFixture.Parse(victimText);
        var claimsToBeTheAttackersBaby = file with
        {
            Baby = file.Baby! with { Id = attackerBaby.BabyId },
            EventTypes = file.EventTypes!.Select(item => item with { BabyId = attackerBaby.BabyId }).ToArray(),
            Medications = file.Medications!.Select(item => item with { BabyId = attackerBaby.BabyId, Name = "hijacked" }).ToArray(),
            Prescriptions = [],
            Formulas = [],
            CareProviders = [],
            Appointments = [],
            Vaccinations = [],
            Measurements = [],
            Notes = [],
            Events = file.Events!.Select(item => item with { BabyId = attackerBaby.BabyId, Notes = "hijacked" }).ToArray(),
        };

        var preview = await (await attacker.Merge(attackerBaby.BabyId, BackupFixture.Seal(claimsToBeTheAttackersBaby), preview: true).Ok()).Content.ReadFromJsonAsync<BackupImportReport>();
        var refused = await attacker.Merge(attackerBaby.BabyId, BackupFixture.Seal(claimsToBeTheAttackersBaby));

        Assert.False(preview!.CanImport);
        Assert.Contains(preview.Issues, issue => issue.Kind == "events" && issue.Code == "event_baby_mismatch");
        Assert.Contains(preview.Issues, issue => issue is { Kind: "medications", Code: "medication_baby_mismatch" });
        await AssertCodeAsync(refused, HttpStatusCode.UnprocessableEntity, "backup_rejected");
        var victimEvent = await factory.QueryAsync(context => context.EventsIncludingDeleted.SingleAsync(stored => stored.Id == victim.BottleEventId));
        Assert.Equal((victim.Baby.BabyId, "good appetite"), (victimEvent.BabyId, victimEvent.Notes));
        var victimMedication = await factory.QueryAsync(context => context.Medications.SingleAsync(medication => medication.Id == victim.MedicationId));
        Assert.Equal((victim.Baby.BabyId, "Colidis"), (victimMedication.BabyId, victimMedication.Name));
        Assert.Equal(0, await factory.QueryAsync(context => context.EventsIncludingDeleted.CountAsync(stored => stored.BabyId == attackerBaby.BabyId)));
    }

    [Fact]
    public async Task Restore_NeverGrantsAccessToTheSourceBabyOrAddsMembers()
    {
        var (rich, text) = await ExportedAsync();
        var subject = TestUsers.NewSubject();
        var stranger = factory.CreateClientFor(subject, "Stranger");

        var report = await (await stranger.Restore(text).Ok()).Content.ReadFromJsonAsync<BackupImportReport>();

        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.GetAsync($"{BackupFixture.BabyPath(rich.Baby.BabyId)}/events")).StatusCode);
        var userId = await factory.UserIdAsync(subject);
        Assert.Equal(1, await factory.QueryAsync(context => context.BabyMembers.CountAsync(member => member.UserId == userId)));
        Assert.Equal(1, await factory.QueryAsync(context => context.BabyMembers.CountAsync(member => member.BabyId == report!.BabyId)));
        Assert.Equal(5, await factory.QueryAsync(context => context.BabyMembers.CountAsync(member => member.BabyId == rich.Baby.BabyId)));
    }

    [Fact]
    public async Task Restore_FileWithAProductLinkThisServerDoesNotKnow_KeepsTheMedicationWithoutTheLink()
    {
        var (_, text) = await ExportedAsync();
        var file = BackupFixture.Parse(text);
        var forged = file with { Medications = file.Medications!.Select(item => item with { ProductId = Guid.NewGuid() }).ToArray() };

        var report = await (await factory.NewUser().Restore(BackupFixture.Seal(forged)).Ok()).Content.ReadFromJsonAsync<BackupImportReport>();

        Assert.Equal((2, 0), (report!.Kinds["medications"].New, report.Kinds["medications"].Invalid));
        Assert.Contains(report.Notices, notice => notice is { Code: "product_links_dropped", Count: 2 });
    }

    [Fact]
    public async Task Restore_KeepsRunningAndDeletedEventsAsTheyWere()
    {
        var (_, text) = await ExportedAsync();
        var report = await (await factory.NewUser().Restore(text).Ok()).Content.ReadFromJsonAsync<BackupImportReport>();

        var running = await factory.QueryAsync(context => context.EventsIncludingDeleted.CountAsync(stored => stored.BabyId == report!.BabyId && stored.EndedAt == null && stored.DeletedAt == null && stored.TypeId == BuiltInEventTypes.MedicationId));
        var deleted = await factory.QueryAsync(context => context.EventsIncludingDeleted.CountAsync(stored => stored.BabyId == report!.BabyId && stored.DeletedAt != null));

        Assert.Equal((1, 1), (running, deleted));
    }

    [Fact]
    public async Task File_RecordsReserializeToTheSameBytes()
    {
        var (_, text) = await ExportedAsync();

        var file = BackupFixture.Parse(text);

        var colidis = file.Medications!.Single(item => item.Name == "Colidis");
        Assert.Equal(new DosageDto { Amount = 2, Unit = "drops" }, colidis.DefaultDosage);
        Assert.Equal(file.Checksum!.Value, BackupDigest.Of(BackupFixture.Parse(JsonSerializer.Serialize(file, BackupJson.Options))));
    }
}
