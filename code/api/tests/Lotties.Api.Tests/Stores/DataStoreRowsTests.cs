using Lotties.Api.Tests.Support;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores.Migration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// The store migrator's mirror of a store's state in <c>data_stores</c> (task T5): written in a DI scope of its own, so a request's
/// control context never carries it, through the domain's transition rule.
/// </summary>
public sealed class DataStoreRowsTests : IDisposable
{
    private readonly ApiFactory _factory = new();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task RecordAsync_MirrorsTheStateAndSchemaVersion()
    {
        var storeId = await SeedStoreAsync();
        var rows = Rows();

        await rows.RecordAsync(storeId, DataStoreState.Migrating, null);
        await rows.RecordAsync(storeId, DataStoreState.Ready, "20261107000000_DataBaseline");

        var stored = await _factory.QueryAsync(context => context.DataStores.AsNoTracking().SingleAsync(store => store.Id == storeId));
        Assert.Equal((DataStoreState.Ready, "20261107000000_DataBaseline"), (stored.State, stored.SchemaVersion));
        Assert.Equal(DataStoreState.Ready, (await rows.FindAsync(storeId))!.State);
    }

    [Fact]
    public async Task RecordAsync_MoveTheDomainRefuses_ThrowsAndKeepsTheRow()
    {
        var storeId = await SeedStoreAsync();
        var rows = Rows();
        await rows.RecordAsync(storeId, DataStoreState.Ready, "v1");

        await Assert.ThrowsAsync<DataStoreStateTransitionException>(() => rows.RecordAsync(storeId, DataStoreState.Pending, null));

        Assert.Equal(DataStoreState.Ready, (await rows.FindAsync(storeId))!.State);
    }

    [Fact]
    public async Task FindAndRecord_UnknownStore_FindNothingAndWriteNothing()
    {
        var rows = Rows();

        await rows.RecordAsync(Guid.NewGuid(), DataStoreState.Ready, "v1");

        Assert.Null(await rows.FindAsync(Guid.NewGuid()));
    }

    private EfDataStoreRows Rows() => new(_factory.Services.GetRequiredService<IServiceScopeFactory>(), TimeProvider.System);

    private async Task<Guid> SeedStoreAsync()
    {
        var owner = Domain.Users.User.Create(Domain.Users.User.UnknownIssuer, TestUsers.NewSubject(), "Owner", TestUsers.Now);
        var store = DataStore.Create(Guid.NewGuid(), owner.Id, TestUsers.Now);
        await _factory.SeedAsync(context =>
        {
            context.Users.Add(owner);
            context.DataStores.Add(store);
            return Task.CompletedTask;
        });
        return store.Id;
    }
}
