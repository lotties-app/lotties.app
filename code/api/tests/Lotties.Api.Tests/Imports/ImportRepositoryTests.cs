using Lotties.Api.Tests.Support;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Imports;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Imports;

/// <summary>The import repository against the SQLite test database (real transactions and primary keys).</summary>
public sealed class ImportRepositoryTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<TResult> WithImportsAsync<TResult>(Func<IImportRepository, Task<TResult>> action)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<IImportRepository>());
    }

    private async Task<(Guid BabyId, Guid UserId)> SeedAsync()
    {
        var baby = await factory.SeedBabyAsync();
        return (baby.BabyId, await factory.UserIdAsync(baby.OwnerSubject));
    }

    private static Event NewEvent(Guid id, Guid babyId, Guid userId) =>
        Event.Create(id, babyId, BuiltInEventTypes.DiaperId, userId, TestUsers.Now, TestUsers.Now, EventPayload.From("""{"content":"WET"}"""), null, TestUsers.Now);

    [Fact]
    public async Task SaveAsync_ManyRecords_SavesEverythingAcrossChunks()
    {
        var (babyId, userId) = await SeedAsync();
        var events = Enumerable.Range(0, 1201).Select(_ => NewEvent(Guid.NewGuid(), babyId, userId)).ToArray();
        var medication = Medication.Create(babyId, "Puravit", null, null, isUsual: false, TestUsers.Now);
        var measurement = Measurement.Create(Guid.NewGuid(), babyId, new DateOnly(2025, 9, 1), 4m, null, null, null, userId, TestUsers.Now);

        await WithImportsAsync(async imports =>
        {
            await imports.SaveAsync(new ImportBatch([medication], events, [measurement]));
            return true;
        });

        Assert.Equal(1201, await factory.QueryAsync(context => context.Events.CountAsync(stored => stored.BabyId == babyId)));
        Assert.True(await factory.QueryAsync(context => context.Medications.AnyAsync(stored => stored.Id == medication.Id)));
        Assert.True(await factory.QueryAsync(context => context.Measurements.AnyAsync(stored => stored.Id == measurement.Id)));
    }

    [Fact]
    public async Task SaveAsync_FailureInALaterChunk_RollsBackEverythingAndThrowsConflict()
    {
        var (babyId, userId) = await SeedAsync();
        var existingId = Guid.NewGuid();
        await WithImportsAsync(async imports =>
        {
            await imports.SaveAsync(new ImportBatch([], [NewEvent(existingId, babyId, userId)], []));
            return true;
        });
        var medication = Medication.Create(babyId, "Flagyl", null, null, isUsual: false, TestUsers.Now);
        var freshEvents = Enumerable.Range(0, EfChunk).Select(_ => NewEvent(Guid.NewGuid(), babyId, userId));
        var batch = new ImportBatch([medication], freshEvents.Append(NewEvent(existingId, babyId, userId)).ToArray(), []);

        await Assert.ThrowsAsync<ImportConflictException>(() => WithImportsAsync(async imports =>
        {
            await imports.SaveAsync(batch);
            return true;
        }));

        Assert.Equal(1, await factory.QueryAsync(context => context.Events.CountAsync(stored => stored.BabyId == babyId)));
        Assert.False(await factory.QueryAsync(context => context.Medications.AnyAsync(stored => stored.Id == medication.Id)));
    }

    private static Event NewNap(Guid babyId, Guid userId) =>
        Event.Create(Guid.NewGuid(), babyId, BuiltInEventTypes.SleepId, userId, TestUsers.Now, TestUsers.Now.AddHours(1), EventPayload.From("""{"kind":"nap"}"""), "note", TestUsers.Now);

    private static EventEnrichment Enrichment(Event stored, string enriched, params string[] fields) =>
        new(stored.Id, stored.Payload, new EnrichedPayload(EventPayload.From(enriched), fields), TestUsers.Now.AddDays(1));

    private Task SaveAsync(ImportBatch batch) => WithImportsAsync(async imports =>
    {
        await imports.SaveAsync(batch);
        return true;
    });

    [Fact]
    public async Task SaveAsync_Enrichment_ReplacesThePayloadAndStampsBothUpdateTimes()
    {
        var (babyId, userId) = await SeedAsync();
        var nap = NewNap(babyId, userId);
        await SaveAsync(new ImportBatch([], [nap], []));

        await SaveAsync(new ImportBatch([], [], []) { Enrichments = [Enrichment(nap, """{"kind":"nap","pause_count":1}""", "pause_count")] });

        var stored = await factory.QueryAsync(context => context.Events.SingleAsync(item => item.Id == nap.Id));
        Assert.Equal(("""{"kind":"nap","pause_count":1}""", "note", nap.StartedAt), (stored.Payload.Value.Replace(" ", string.Empty, StringComparison.Ordinal), stored.Notes, stored.StartedAt));
        Assert.Equal((TestUsers.Now.AddDays(1), TestUsers.Now.AddDays(1)), (stored.UpdatedAt, stored.ClientUpdatedAt));
    }

    [Fact]
    public async Task SaveAsync_EnrichmentOfAnEventChangedSinceThePlan_RollsBackTheInsertsAndThrowsConflict()
    {
        var (babyId, userId) = await SeedAsync();
        var nap = NewNap(babyId, userId);
        await SaveAsync(new ImportBatch([], [nap], []));
        var stale = Enrichment(nap, """{"kind":"nap","pause_count":1}""", "pause_count") with
        {
            ExpectedPayload = EventPayload.From("""{"kind":"night"}"""),
        };
        var fresh = NewEvent(Guid.NewGuid(), babyId, userId);

        await Assert.ThrowsAsync<ImportConflictException>(() => SaveAsync(new ImportBatch([], [fresh], []) { Enrichments = [stale] }));

        Assert.False(await factory.QueryAsync(context => context.EventsIncludingDeleted.AnyAsync(item => item.Id == fresh.Id)));
        Assert.Equal("""{"kind":"nap"}""", (await factory.QueryAsync(context => context.Events.SingleAsync(item => item.Id == nap.Id))).Payload.Value.Replace(" ", string.Empty, StringComparison.Ordinal));
    }

    [Fact]
    public async Task SaveAsync_EnrichmentOfASoftDeletedEvent_ThrowsConflictAndSavesNothing()
    {
        var (babyId, userId) = await SeedAsync();
        var nap = NewNap(babyId, userId);
        var enrichment = Enrichment(nap, """{"kind":"nap","pause_count":1}""", "pause_count");
        nap.SoftDelete(TestUsers.Now);
        await SaveAsync(new ImportBatch([], [nap], []));

        await Assert.ThrowsAsync<ImportConflictException>(() => SaveAsync(new ImportBatch([], [], []) { Enrichments = [enrichment] }));

        Assert.Equal("""{"kind":"nap"}""", (await factory.QueryAsync(context => context.EventsIncludingDeleted.SingleAsync(item => item.Id == nap.Id))).Payload.Value.Replace(" ", string.Empty, StringComparison.Ordinal));
    }

    [Fact]
    public async Task FindEventsAsync_ReturnsOnlyTheBabysEventsThatAreNotDeleted()
    {
        var (babyId, userId) = await SeedAsync();
        var (otherBabyId, otherUserId) = await SeedAsync();
        var kept = NewNap(babyId, userId);
        var deleted = NewNap(babyId, userId);
        deleted.SoftDelete(TestUsers.Now);
        var foreign = NewNap(otherBabyId, otherUserId);
        await SaveAsync(new ImportBatch([], [kept, deleted, foreign], []));

        var found = await WithImportsAsync(imports => imports.FindEventsAsync(babyId, [kept.Id, deleted.Id, foreign.Id, Guid.NewGuid()]));

        Assert.Equal([kept.Id], found.Select(item => item.Id));
    }

    [Fact]
    public async Task FindExistingEventIdsAsync_ReturnsOnlyStoredIdsIncludingSoftDeleted()
    {
        var (babyId, userId) = await SeedAsync();
        var stored = NewEvent(Guid.NewGuid(), babyId, userId);
        stored.SoftDelete(TestUsers.Now);
        await WithImportsAsync(async imports =>
        {
            await imports.SaveAsync(new ImportBatch([], [stored], []));
            return true;
        });

        var found = await WithImportsAsync(imports => imports.FindExistingEventIdsAsync([stored.Id, Guid.NewGuid()]));

        Assert.Equal([stored.Id], found);
    }

    [Fact]
    public async Task FindExistingMeasurementIdsAsync_ManyIds_IsChunkedAndReturnsStoredOnes()
    {
        var (babyId, userId) = await SeedAsync();
        var measurement = Measurement.Create(Guid.NewGuid(), babyId, new DateOnly(2025, 9, 2), 4.2m, null, null, null, userId, TestUsers.Now);
        await WithImportsAsync(async imports =>
        {
            await imports.SaveAsync(new ImportBatch([], [], [measurement]));
            return true;
        });
        var ids = Enumerable.Range(0, 1200).Select(_ => Guid.NewGuid()).Append(measurement.Id).ToArray();

        var found = await WithImportsAsync(imports => imports.FindExistingMeasurementIdsAsync(ids));

        Assert.Equal([measurement.Id], found);
    }

    private const int EfChunk = 500;
}
