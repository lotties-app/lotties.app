using System.IO.Compression;
using System.Net;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Backups;
using Lotties.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Backups;

public sealed class BackupExportEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Export_ByOwner_WritesTheVersionedFileWithEverySectionAndSoftDeletedRecords()
    {
        var rich = await factory.SeedRichBabyAsync();

        var text = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);

        var file = BackupFixture.Parse(text);
        Assert.Equal((BackupFile.FormatName, 1), (file.Format, file.SchemaVersion));
        Assert.Equal(rich.Baby.BabyId, file.Baby!.Id);
        Assert.Equal(("Lia", "public+private", 36), (file.Baby.Name, file.Baby.VaccineProfile, file.Baby.GestationalAgeWeeks));
        Assert.Equal(
            new Dictionary<string, int>
            {
                ["baby"] = 1, ["eventTypes"] = 1, ["medications"] = 2, ["prescriptions"] = 2, ["formulas"] = 2, ["careProviders"] = 2, ["appointments"] = 1,
                ["vaccinations"] = 2, ["measurements"] = 2, ["notes"] = 1, ["events"] = 5,
            },
            file.Counts);
        Assert.Equal(1, file.Prescriptions!.Count(prescription => prescription.DeletedAt is not null));
        Assert.Equal(1, file.Vaccinations!.Count(vaccination => vaccination.DeletedAt is not null));
        Assert.Equal(1, file.CareProviders!.Count(provider => provider.IsDeleted));
        Assert.Equal(1, file.Events!.Count(stored => stored.DeletedAt is not null));
        Assert.Equal(BackupChecksum.Sha256, file.Checksum!.Algorithm);
        Assert.Equal(file.Checksum.Value, BackupDigest.Of(file));
        Assert.Equal("Lotties", file.App!.Name);
    }

    [Fact]
    public async Task Export_IsReadable_OneRecordPerLineAndKeepsAccents()
    {
        var rich = await factory.SeedRichBabyAsync();

        var text = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);

        Assert.Contains("\"format\": \"lotties-backup\"", text, StringComparison.Ordinal);
        Assert.Contains("Dose única", text, StringComparison.Ordinal);
        Assert.Contains("\n", text, StringComparison.Ordinal);
        Assert.DoesNotContain("\\u00FA", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Export_NeverNamesAnAccountOrAnotherUsersPrivateNote()
    {
        var rich = await factory.SeedRichBabyAsync();
        var userIds = new List<Guid>();
        foreach (var role in new[] { BabyRole.Owner, BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor })
        {
            userIds.Add(await factory.UserIdAsync(rich.Baby.SubjectOf(role)));
        }

        var text = await rich.Owner.ExportTextAsync(rich.Baby.BabyId);

        userIds.ForEach(id => Assert.DoesNotContain(id.ToString(), text, StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain("test|", text, StringComparison.Ordinal);
        Assert.DoesNotContain("Mother seemed anxious.", text, StringComparison.Ordinal);
        Assert.Contains("Offer 120 ml every 3 hours.", text, StringComparison.Ordinal);
        var file = BackupFixture.Parse(text);
        Assert.Equal(file.People!.Select(person => person.Id).Order(), file.Events!.Select(stored => stored.CreatedBy).Concat(file.Notes!.Select(note => note.AuthorUserId)).Concat([file.ExportedBy]).Distinct().Order());
    }

    [Fact]
    public async Task Export_DefaultIsGzip_AndHoldsTheSameFile()
    {
        var rich = await factory.SeedRichBabyAsync();

        var response = await rich.Owner.GetAsync($"{BackupFixture.BabyPath(rich.Baby.BabyId)}/export").Ok();

        Assert.Equal("application/gzip", response.Content.Headers.ContentType?.MediaType);
        Assert.EndsWith(".json.gz", response.Content.Headers.ContentDisposition?.FileName?.Trim('"'), StringComparison.Ordinal);
        Assert.StartsWith("lotties-backup-lia-", response.Content.Headers.ContentDisposition?.FileName?.Trim('"'), StringComparison.Ordinal);
        await using var gzip = new GZipStream(await response.Content.ReadAsStreamAsync(), CompressionMode.Decompress);
        using var reader = new StreamReader(gzip);
        var file = BackupFixture.Parse(await reader.ReadToEndAsync());
        Assert.Equal(rich.Baby.BabyId, file.Baby!.Id);
        Assert.Equal(file.Checksum!.Value, BackupDigest.Of(file));
    }

    [Theory]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Doctor)]
    public async Task Export_ByOtherRoles_Returns403(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor);

        var response = await factory.As(baby, role).GetAsync($"{BackupFixture.BabyPath(baby.BabyId)}/export");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Export_ByParent_Works()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);

        var response = await factory.As(baby, BabyRole.Parent).GetAsync($"{BackupFixture.BabyPath(baby.BabyId)}/export?compress=false").Ok();

        Assert.Equal(baby.BabyId, BackupFixture.Parse(await response.Content.ReadAsStringAsync()).Baby!.Id);
    }

    [Fact]
    public async Task Export_WritesNothing()
    {
        var rich = await factory.SeedRichBabyAsync();
        var before = await factory.QueryAsync(context => context.EventsIncludingDeleted.CountAsync(stored => stored.BabyId == rich.Baby.BabyId));

        await rich.Owner.ExportTextAsync(rich.Baby.BabyId);

        Assert.Equal(before, await factory.QueryAsync(context => context.EventsIncludingDeleted.CountAsync(stored => stored.BabyId == rich.Baby.BabyId)));
        Assert.Equal(0, await factory.QueryAsync(context => context.AccessLog.CountAsync(entry => entry.BabyId == rich.Baby.BabyId)));
    }

    [Fact]
    public async Task Export_ManyEvents_ComesInPagesAndKeepsEveryOne()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var now = DateTimeOffset.UtcNow;
        const int total = 3_200;
        await factory.SeedAsync(context =>
        {
            for (var index = 0; index < total; index++)
            {
                context.Events.Add(Lotties.Domain.Events.Event.Create(Guid.NewGuid(), baby.BabyId, Lotties.Domain.EventTypes.BuiltInEventTypes.BathId, ownerId, now.AddMinutes(-index), null, Lotties.Domain.Events.EventPayload.Empty, null, now));
            }

            return Task.CompletedTask;
        });

        var text = await factory.As(baby, BabyRole.Owner).ExportTextAsync(baby.BabyId);

        var file = BackupFixture.Parse(text);
        Assert.Equal(total, file.Events!.Count);
        Assert.Equal(total, file.Counts!["events"]);
        Assert.Equal(total, file.Events.Select(stored => stored.Id).Distinct().Count());
        Assert.Equal(file.Checksum!.Value, BackupDigest.Of(file));
        using var document = JsonDocument.Parse(text);
        Assert.Equal(total, document.RootElement.GetProperty("events").GetArrayLength());
    }
}
