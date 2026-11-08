using Lotties.Domain.Stores;

namespace Lotties.Domain.Tests.Stores;

/// <summary>
/// The identity of a data store, a baby's route to it and its pointer with the store epoch (docs/design/47-bring-your-own-database.md
/// sections 2.1 and 2.3).
/// </summary>
public sealed class DataStoreTests
{
    private static readonly Guid StoreX = Guid.Parse("5a000000-0000-4000-8000-000000000001");
    private static readonly Guid StoreY = Guid.Parse("5a000000-0000-4000-8000-000000000002");
    private static readonly Guid BabyId = Guid.Parse("b0000000-0000-4000-8000-000000000001");

    [Fact]
    public void DataStoreKey_BuiltIn_HasNoIdAndTheBuiltInKind()
    {
        Assert.Null(DataStoreKey.BuiltIn.Id);
        Assert.Equal(DataStoreKind.BuiltIn, DataStoreKey.BuiltIn.Kind);
        Assert.Equal(DataStoreKey.BuiltIn, DataStoreKey.Of(null));
        Assert.Equal(DataStoreKey.BuiltIn, default);
    }

    [Fact]
    public void DataStoreKey_External_IsTheStoreWithThatId()
    {
        var key = DataStoreKey.External(StoreX);

        Assert.Equal((StoreX, DataStoreKind.External), (key.Id, key.Kind));
        Assert.Equal(key, DataStoreKey.Of(StoreX));
        Assert.NotEqual(key, DataStoreKey.External(StoreY));
        Assert.NotEqual(key, DataStoreKey.BuiltIn);
    }

    [Fact]
    public void DataStoreKey_ExternalWithoutId_Throws()
    {
        Assert.Throws<ArgumentException>(() => DataStoreKey.External(Guid.Empty));
        Assert.Throws<ArgumentException>(() => DataStoreKey.Of(Guid.Empty));
    }

    [Fact]
    public void StoreRoute_NegativeEpoch_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new StoreRoute(DataStoreKey.BuiltIn, -1));
    }

    [Fact]
    public void StoreRoute_BuiltInDefault_IsTheBuiltInStoreAtEpochZero()
    {
        Assert.Equal(new StoreRoute(DataStoreKey.BuiltIn, 0), StoreRoute.BuiltInDefault);
    }

    [Fact]
    public void BabyStoreAssignment_ForNewBaby_IsTheBuiltInStoreAtEpochZero()
    {
        var assignment = BabyStoreAssignment.ForNewBaby(BabyId);

        Assert.Equal((BabyId, (Guid?)null, 0), (assignment.BabyId, assignment.DataStoreId, assignment.Epoch));
        Assert.Equal(StoreRoute.BuiltInDefault, assignment.Route);
    }

    [Fact]
    public void BabyStoreAssignment_MoveTo_EveryMoveChangesTheEpoch()
    {
        var assignment = BabyStoreAssignment.ForNewBaby(BabyId);

        var moved = new[]
        {
            assignment.MoveTo(DataStoreKey.External(StoreX)),
            assignment.MoveTo(DataStoreKey.External(StoreY)),
            assignment.MoveTo(DataStoreKey.BuiltIn),
        };

        Assert.Equal([true, true, true], moved);
        Assert.Equal(new StoreRoute(DataStoreKey.BuiltIn, 3), assignment.Route);
        Assert.Null(assignment.DataStoreId);
    }

    [Fact]
    public void BabyStoreAssignment_MoveToTheSameStore_ChangesNothing()
    {
        var assignment = BabyStoreAssignment.ForNewBaby(BabyId);
        assignment.MoveTo(DataStoreKey.External(StoreX));

        var moved = assignment.MoveTo(DataStoreKey.External(StoreX));

        Assert.False(moved);
        Assert.Equal(new StoreRoute(DataStoreKey.External(StoreX), 1), assignment.Route);
    }

    [Fact]
    public void DataStore_Create_IsPendingWithoutADescriptorInUtc()
    {
        var store = DataStore.Create(StoreX, BabyId, new DateTimeOffset(2026, 1, 10, 9, 0, 0, TimeSpan.FromHours(-3)));

        Assert.Equal((StoreX, BabyId, DataStoreState.Pending), (store.Id, store.OwnerUserId, store.State));
        Assert.Null(store.SealedDescriptor);
        Assert.Equal(new DateTimeOffset(2026, 1, 10, 12, 0, 0, TimeSpan.Zero), store.CreatedAt);
        Assert.Equal(TimeSpan.Zero, store.UpdatedAt.Offset);
    }

    [Fact]
    public void DataStore_CreateWithoutIds_Throws()
    {
        Assert.Throws<ArgumentException>(() => DataStore.Create(Guid.Empty, BabyId, DateTimeOffset.UnixEpoch));
        Assert.Throws<ArgumentException>(() => DataStore.Create(StoreX, Guid.Empty, DateTimeOffset.UnixEpoch));
    }

    [Fact]
    public void DataStore_ReplaceDescriptor_StoresItGoesPendingAndForgetsTheLastTest()
    {
        var store = DataStore.Create(StoreX, BabyId, DateTimeOffset.UnixEpoch);
        store.RecordMigrationState(DataStoreState.Ready, "v1", DateTimeOffset.UnixEpoch);
        store.RecordCheck("ok", DateTimeOffset.UnixEpoch);

        store.ReplaceDescriptor(SealedDescriptor.FromBytes([1, 2, 3]), "Example Cloud", DateTimeOffset.UnixEpoch.AddHours(1));

        Assert.Equal((DataStoreState.Pending, "Example Cloud", true, "v1"), (store.State, store.ProviderLabel, store.HasDescriptor, store.SchemaVersion));
        Assert.Equal([1, 2, 3], store.SealedDescriptor);
        Assert.Equal((null, null), (store.LastCheckedAt, store.LastCheckResult));
        Assert.Equal(DateTimeOffset.UnixEpoch.AddHours(1), store.UpdatedAt);
    }

    [Fact]
    public void DataStore_ReplaceDescriptorOfADisabledStore_StaysDisabled()
    {
        var store = DataStore.Create(StoreX, BabyId, DateTimeOffset.UnixEpoch);
        typeof(DataStore).GetProperty(nameof(DataStore.State))!.SetValue(store, DataStoreState.Disabled);

        store.ReplaceDescriptor(SealedDescriptor.FromBytes([1]), "x", DateTimeOffset.UnixEpoch);

        Assert.Equal(DataStoreState.Disabled, store.State);
    }

    [Fact]
    public void DataStore_RecordCheck_KeepsTheStateAndRecordsTheCodeInUtc()
    {
        var store = DataStore.Create(StoreX, BabyId, DateTimeOffset.UnixEpoch);

        store.RecordCheck("store_credentials_rejected", new DateTimeOffset(2026, 1, 10, 9, 0, 0, TimeSpan.FromHours(-3)));

        Assert.Equal((DataStoreState.Pending, "store_credentials_rejected"), (store.State, store.LastCheckResult));
        Assert.Equal(new DateTimeOffset(2026, 1, 10, 12, 0, 0, TimeSpan.Zero), store.LastCheckedAt);
    }

    [Fact]
    public void FirstStoreIdOf_SameOwner_SameIdAndDifferentPerOwner()
    {
        Assert.Equal(DataStore.FirstStoreIdOf(BabyId), DataStore.FirstStoreIdOf(BabyId));
        Assert.NotEqual(DataStore.FirstStoreIdOf(BabyId), DataStore.FirstStoreIdOf(StoreX));
        Assert.Throws<ArgumentException>(() => DataStore.FirstStoreIdOf(Guid.Empty));
    }
}
