using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Backups;
using Lotties.Domain.EventTypes;

namespace Lotties.Api.Tests.Backups;

/// <summary>
/// Writes a synthetic demo backup (<c>lotties-backup</c>, docs/design/24-export-import.md): two weeks of invented sleep,
/// bottle and diaper events for a made-up baby, for the Alexa certification reviewers' demo account (docs/ALEXA-SUBMISSION.md
/// step 2). It does nothing unless <c>LOTTIES_DEMO_BACKUP_OUT</c> names the output file, e.g.
/// <c>LOTTIES_DEMO_BACKUP_OUT=C:\tmp\lia.json dotnet test code/api/tests/Lotties.Api.Tests --filter DemoBackupGenerator</c>.
/// Before writing, it restores the file into a new baby through the real import service and fails on any issue, so the app
/// is known to accept what it produced. Nothing here is real data: names, times and amounts are generated.
/// </summary>
public sealed class DemoBackupGenerator(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string OutputVariable = "LOTTIES_DEMO_BACKUP_OUT";
    private const string BabyName = "Lia";

    /// <summary>The baby's local zone (Brazil): events are scheduled by local clock, written in UTC.</summary>
    private static readonly TimeSpan LocalOffset = TimeSpan.FromHours(-3);

    private static readonly DateOnly FirstDay = new(2026, 10, 12);
    private static readonly DateOnly LastDay = new(2026, 10, 25);

    [Fact]
    public async Task Writes_a_demo_backup_that_the_app_accepts_when_asked_to()
    {
        var output = Environment.GetEnvironmentVariable(OutputVariable);
        if (string.IsNullOrWhiteSpace(output))
        {
            return;
        }

        var file = Build();
        var text = Seal(file);

        var importer = factory.NewUser("Demo importer");
        var preview = await Report(await importer.Restore(text, preview: true));
        Assert.True(preview.CanImport, "The demo backup is not importable: " + string.Join("; ", preview.Issues.Select(issue => issue.ToString())));
        Assert.Equal(0, preview.IssueCount);
        var applied = await Report(await importer.Restore(text));
        Assert.True(applied.Applied);
        Assert.Equal(0, applied.IssueCount);
        Assert.Equal(file.Events!.Count, applied.Kinds["events"].New);

        await File.WriteAllTextAsync(output, text, new UTF8Encoding(false));
    }

    private static async Task<BackupImportReport> Report(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {body}");
        return JsonSerializer.Deserialize<BackupImportReport>(body, BackupJson.Options)!;
    }

    /// <summary>The checksum is the app's own, computed with the code that verifies it; the layout is indented for people.</summary>
    private static string Seal(BackupFile file)
    {
        var counts = BackupFile.SectionOrder.ToDictionary(section => section, section => file.Records(section).Count);
        var sealedFile = file with { Counts = counts, Checksum = null };
        sealedFile = sealedFile with { Checksum = new BackupChecksum { Algorithm = BackupChecksum.Sha256, Value = BackupDigest.Of(sealedFile) } };
        var options = new JsonSerializerOptions(BackupJson.Options) { WriteIndented = true };
        return JsonSerializer.Serialize(sealedFile, options);
    }

    private static BackupFile Build()
    {
        var exportedAt = new DateTimeOffset(2026, 10, 25, 23, 30, 0, TimeSpan.Zero);
        var babyId = StableGuid("demo-baby");
        var author = StableGuid("demo-parent");
        var events = Events(babyId, author);
        return new BackupFile
        {
            Format = BackupFile.FormatName,
            SchemaVersion = BackupFile.CurrentSchemaVersion,
            ExportedAt = exportedAt,
            App = new BackupApp { Name = "Lotties", Version = "demo" },
            ExportedBy = author,
            Baby = new BackupBaby
            {
                Id = babyId,
                Name = BabyName,
                BirthDate = new DateOnly(2026, 6, 20),
                CreatedAt = new DateTimeOffset(2026, 10, 11, 12, 0, 0, TimeSpan.Zero),
                VaccineProfile = "public",
            },
            EventTypes = [],
            Medications = [],
            Prescriptions = [],
            Formulas = [],
            CareProviders = [],
            Appointments = [],
            Vaccinations = [],
            Measurements = [],
            Notes = [],
            Events = events,
            People = [new BackupPerson { Id = author, DisplayName = "Demo parent" }],
        };
    }

    private static List<BackupEvent> Events(Guid babyId, Guid author)
    {
        var list = new List<BackupEvent>();
        for (var day = FirstDay.AddDays(-1); day <= LastDay; day = day.AddDays(1))
        {
            var random = new Random(day.DayNumber);
            var isFirstDayBefore = day < FirstDay;

            // Night sleep: from this evening to tomorrow morning (the evening before the first day is part of the history).
            var nightStart = At(day, 20, 30, random.Next(-20, 21));
            var nightEnd = At(day.AddDays(1), 6, 30, random.Next(-20, 21));
            if (day < LastDay)
            {
                list.Add(Sleep(babyId, author, nightStart, nightEnd, "night"));
            }

            if (isFirstDayBefore)
            {
                continue;
            }

            foreach (var (hour, minute, length) in new[] { (8, 45, 75), (12, 15, 90), (15, 45, 45) })
            {
                var start = At(day, hour, minute, random.Next(-15, 16));
                list.Add(Sleep(babyId, author, start, start.AddMinutes(length + random.Next(-10, 11)), "nap"));
            }

            var bottleTimes = new[] { (6, 50), (9, 50), (13, 30), (16, 30), (19, 45) };
            for (var i = 0; i < bottleTimes.Length; i++)
            {
                var (hour, minute) = bottleTimes[i];
                var amount = new[] { 120, 130, 140, 150 }[random.Next(4)];
                var breastMilk = i == 3 && day.DayNumber % 2 == 0;
                list.Add(Bottle(babyId, author, At(day, hour, minute, random.Next(-10, 11)), amount, breastMilk));
            }

            var diaperTimes = new[] { (6, 45), (9, 55), (12, 10), (15, 0), (17, 30), (19, 50), (21, 50) };
            for (var i = 0; i < diaperTimes.Length; i++)
            {
                var (hour, minute) = diaperTimes[i];
                var content = i == 2 || (i == 5 && day.DayNumber % 3 == 0) ? "DIRTY" : (i == 4 && day.DayNumber % 4 == 0 ? "MIXED" : "WET");
                list.Add(Diaper(babyId, author, At(day, hour, minute, random.Next(-10, 11)), content));
            }
        }

        return [.. list.OrderBy(item => item.StartedAt).ThenBy(item => item.Id)];
    }

    private static DateTimeOffset At(DateOnly day, int hour, int minute, int jitterMinutes) =>
        new DateTimeOffset(day.Year, day.Month, day.Day, hour, minute, 0, LocalOffset).AddMinutes(jitterMinutes).ToUniversalTime();

    private static BackupEvent Sleep(Guid babyId, Guid author, DateTimeOffset start, DateTimeOffset end, string kind) =>
        Event(babyId, author, BuiltInEventTypes.SleepId, start, end, "{\"kind\":\"" + kind + "\"}");

    private static BackupEvent Bottle(Guid babyId, Guid author, DateTimeOffset start, int amountMl, bool breastMilk) =>
        Event(babyId, author, BuiltInEventTypes.FeedingId, start, null, "{\"method\":\"bottle\",\"amount_ml\":" + amountMl + ",\"bottle_feeding_type\":\"" + (breastMilk ? "breast_milk" : "formula") + "\"}");

    private static BackupEvent Diaper(Guid babyId, Guid author, DateTimeOffset start, string content) =>
        Event(babyId, author, BuiltInEventTypes.DiaperId, start, null, "{\"content\":\"" + content + "\"}");

    private static BackupEvent Event(Guid babyId, Guid author, Guid typeId, DateTimeOffset start, DateTimeOffset? end, string payload)
    {
        var stamp = end ?? start;
        return new BackupEvent
        {
            Id = StableGuid($"{typeId}|{start:O}"),
            BabyId = babyId,
            TypeId = typeId,
            StartedAt = start,
            EndedAt = end,
            Payload = JsonDocument.Parse(payload).RootElement.Clone(),
            CreatedBy = author,
            CreatedAt = stamp,
            UpdatedAt = stamp,
            ClientUpdatedAt = stamp,
        };
    }

    private static Guid StableGuid(string seed) => new(MD5.HashData(Encoding.UTF8.GetBytes("lotties-demo|" + seed)));
}
