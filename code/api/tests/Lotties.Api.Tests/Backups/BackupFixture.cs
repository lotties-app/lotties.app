using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Backups;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;

namespace Lotties.Api.Tests.Backups;

/// <summary>What <see cref="BackupFixture.SeedRichBabyAsync"/> created, by the ids a test needs.</summary>
internal sealed record RichBaby(
    SeededBaby Baby,
    HttpClient Owner,
    Guid CustomTypeId,
    Guid MedicationId,
    Guid PrescriptionId,
    Guid FormulaId,
    Guid ProviderId,
    Guid BottleEventId,
    Guid MedicationEventId,
    Guid DeletedEventId,
    Guid SharedNoteId,
    Guid PrivateNoteId);

/// <summary>Builds a baby with every kind of record through the real endpoints, and the HTTP helpers the backup tests share.</summary>
internal static class BackupFixture
{
    public static readonly DateTimeOffset Start = new(2026, 1, 10, 8, 0, 0, TimeSpan.Zero);

    public static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    public static HttpClient As(this ApiFactory factory, SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    public static HttpClient NewUser(this ApiFactory factory, string name = "Restorer") => factory.CreateClientFor(TestUsers.NewSubject(), name);

    public static async Task<HttpResponseMessage> Ok(this Task<HttpResponseMessage> request) => await Ok(await request);

    public static async Task<HttpResponseMessage> Ok(this HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return response;
    }

    public static async Task<RichBaby> SeedRichBabyAsync(this ApiFactory factory, int extraBathEvents = 0)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor);
        var owner = factory.As(baby, BabyRole.Owner);
        var path = BabyPath(baby.BabyId);
        await owner.PutAsJsonAsync($"{path}/vaccine-profile", new { vaccineProfile = "public+private", gestationalAgeWeeks = 36, rsvMaternalVaccination = "yes" }).Ok();

        var customType = await (await owner.PostAsJsonAsync(
            $"{path}/event-types",
            new { key = "pump", name = "Pump", icon = "water_drop", color = "#123456", hasDuration = false, fields = new[] { new { key = "amount_ml", label = "Amount", kind = "number", min = 0, unit = "ml" } } }).Ok())
            .ReadAsync<JsonElement>();
        var customTypeId = customType.GetProperty("id").GetGuid();

        var medicationId = Guid.NewGuid();
        await owner.PutAsJsonAsync($"{path}/medications/{medicationId}", new { name = "Colidis", isUsual = true, defaultDosage = new { amount = 2, unit = "drops" }, notes = "before feeds" }).Ok();
        await owner.PutAsJsonAsync($"{path}/medications/{Guid.NewGuid()}", new { name = "Vitamin D", isUsual = false }).Ok();

        var prescriptionId = Guid.NewGuid();
        await owner.PutAsJsonAsync(
            $"{path}/prescriptions/{prescriptionId}",
            new { medicationId, kind = "asNeeded", dose = new { amount = 2, unit = "drops" }, minIntervalMinutes = 480, maxDosesPer24h = 3, indication = "belly pain", startDate = "2026-01-01", prescriber = "Dr. Ana" }).Ok();
        var droppedPrescription = Guid.NewGuid();
        await owner.PutAsJsonAsync(
            $"{path}/prescriptions/{droppedPrescription}",
            new { medicationId, kind = "asNeeded", dose = new { amount = 1, unit = "drops" }, minIntervalMinutes = 240, maxDosesPer24h = 4, startDate = "2025-12-01", endDate = "2025-12-10" }).Ok();
        await owner.DeleteAsync($"{path}/prescriptions/{droppedPrescription}").Ok();

        var formulaId = Guid.NewGuid();
        await owner.PutAsJsonAsync($"{path}/formulas/{formulaId}", new { name = "Aptamil 2", brand = "Aptamil", stage = "2", startedOn = "2026-01-01", isCurrent = true, archived = false }).Ok();
        await owner.PutAsJsonAsync($"{path}/formulas/{Guid.NewGuid()}", new { name = "Nan 1", brand = "Nan", stage = "1", isCurrent = false, archived = true }).Ok();

        var providerId = Guid.NewGuid();
        await owner.PutAsJsonAsync($"{path}/care-providers/{providerId}", new { name = "Dr. Ana Lima", specialty = "pediatrician", clinicName = "Clinic Central", phone = "+55 11 5555-0000", isFavorite = true }).Ok();
        await owner.PutAsJsonAsync($"{path}/care-providers/{Guid.NewGuid()}", new { name = "Dr. Old", isDeleted = true }).Ok();

        await owner.PutAsJsonAsync(
            $"{path}/appointments/{Guid.NewGuid()}",
            new { title = "Pediatrician", type = "consultation", startsAt = Start.AddDays(40), durationMinutes = 30, providerId, reminderOffsetsMinutes = new[] { 120 }, status = "upcoming" }).Ok();

        await owner.PutAsJsonAsync($"{path}/vaccinations/{Guid.NewGuid()}", new { vaccineKey = "bcg", doseId = "bcg-1", doseLabel = "Dose única", givenOn = "2026-01-05", network = "public", lot = "L1" }).Ok();
        var removedVaccination = Guid.NewGuid();
        await owner.PutAsJsonAsync($"{path}/vaccinations/{removedVaccination}", new { customName = "Flu", doseLabel = "1", givenOn = "2026-02-01", network = "private" }).Ok();
        await owner.DeleteAsync($"{path}/vaccinations/{removedVaccination}").Ok();

        await owner.PutAsJsonAsync($"{path}/measurements/{Guid.NewGuid()}", new { date = "2026-01-09", weightKg = 5.4m, heightCm = 58.5m, headCircumferenceCm = 38m, notes = "check-up" }).Ok();
        await owner.PutAsJsonAsync($"{path}/measurements/{Guid.NewGuid()}", new { date = "2026-02-09", weightKg = 6.1m }).Ok();

        var doctor = factory.As(baby, BabyRole.Doctor);
        var sharedNoteId = Guid.NewGuid();
        var privateNoteId = Guid.NewGuid();
        await doctor.PutAsJsonAsync($"{path}/notes/{sharedNoteId}", new { kind = "recommendation", visibility = "shared", body = "Offer 120 ml every 3 hours." }).Ok();
        await doctor.PutAsJsonAsync($"{path}/notes/{privateNoteId}", new { kind = "note", visibility = "private", body = "Mother seemed anxious." }).Ok();

        var bottleEventId = Guid.NewGuid();
        await owner.PutAsJsonAsync(
            $"{path}/events/{bottleEventId}",
            new
            {
                typeId = BuiltInEventTypes.FeedingId,
                startedAt = Start,
                endedAt = Start.AddMinutes(20),
                payload = new { method = "bottle", amount_ml = 120, amount_drunk_ml = 100, bottle_feeding_type = "formula", formula_id = formulaId, formula_name = "Aptamil 2" },
                notes = "good appetite",
            }).Ok();
        var medicationEventId = Guid.NewGuid();
        await owner.PutAsJsonAsync(
            $"{path}/events/{medicationEventId}",
            new
            {
                typeId = BuiltInEventTypes.MedicationId,
                startedAt = Start.AddHours(2),
                endedAt = (DateTimeOffset?)null,
                payload = new { medications = new[] { new { medicationId, name = "Colidis", dose = new { amount = 2, unit = "drops" }, prescriptionId } } },
            }).Ok();
        await owner.PutAsJsonAsync($"{path}/events/{Guid.NewGuid()}", new { typeId = customTypeId, startedAt = Start.AddHours(3), payload = new { amount_ml = 80 }, notes = "custom" }).Ok();
        await owner.PutAsJsonAsync($"{path}/events/{Guid.NewGuid()}", new { typeId = BuiltInEventTypes.FeedingId, startedAt = Start.AddHours(4), payload = new { method = "breast", side = "left" } }).Ok();
        var deletedEventId = Guid.NewGuid();
        await owner.PutAsJsonAsync($"{path}/events/{deletedEventId}", new { typeId = BuiltInEventTypes.BathId, startedAt = Start.AddHours(5), payload = new { } }).Ok();
        await owner.DeleteAsync($"{path}/events/{deletedEventId}").Ok();
        for (var index = 0; index < extraBathEvents; index++)
        {
            await owner.PutAsJsonAsync($"{path}/events/{Guid.NewGuid()}", new { typeId = BuiltInEventTypes.BathId, startedAt = Start.AddMinutes(index), payload = new { } }).Ok();
        }

        return new RichBaby(baby, owner, customTypeId, medicationId, prescriptionId, formulaId, providerId, bottleEventId, medicationEventId, deletedEventId, sharedNoteId, privateNoteId);
    }

    public static async Task<string> ExportTextAsync(this HttpClient client, Guid babyId)
    {
        var response = await client.GetAsync($"{BabyPath(babyId)}/export?compress=false").Ok();
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        return await response.Content.ReadAsStringAsync();
    }

    public static ByteArrayContent Body(string json) => Body(System.Text.Encoding.UTF8.GetBytes(json));

    public static ByteArrayContent Body(byte[] bytes)
    {
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        return content;
    }

    public static byte[] Gzip(byte[] bytes)
    {
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Fastest, leaveOpen: true))
        {
            gzip.Write(bytes);
        }

        return output.ToArray();
    }

    public static Task<HttpResponseMessage> Restore(this HttpClient client, string json, bool preview = false) =>
        client.PostAsync(preview ? "/api/v1/babies/import/preview" : "/api/v1/babies/import", Body(json));

    public static Task<HttpResponseMessage> Merge(this HttpClient client, Guid babyId, string json, bool preview = false) =>
        client.PostAsync($"{BabyPath(babyId)}/import/backup{(preview ? "/preview" : string.Empty)}", Body(json));

    public static BackupFile Parse(string json) => JsonSerializer.Deserialize<BackupFile>(json, BackupJson.Options)!;

    /// <summary>The file as text with its checksum recomputed, so a test can forge a file the reader accepts.</summary>
    public static string Seal(BackupFile file)
    {
        var counts = BackupFile.SectionOrder.ToDictionary(section => section, section => file.Records(section).Count);
        var sealedFile = file with { Counts = counts, Checksum = null };
        sealedFile = sealedFile with { Checksum = new BackupChecksum { Algorithm = BackupChecksum.Sha256, Value = BackupDigest.Of(sealedFile) } };
        return JsonSerializer.Serialize(sealedFile, BackupJson.Options);
    }

    public static HttpStatusCode Status(this HttpResponseMessage response) => response.StatusCode;
}
