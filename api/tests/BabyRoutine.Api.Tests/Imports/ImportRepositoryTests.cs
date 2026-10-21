using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Imports;
using BabyRoutine.Domain.Measurements;
using BabyRoutine.Domain.Medications;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BabyRoutine.Api.Tests.Imports;

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
