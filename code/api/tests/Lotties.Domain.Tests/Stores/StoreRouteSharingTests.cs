using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;

namespace Lotties.Domain.Tests.Stores;

/// <summary>A baby on a family's own database is Owner only in the first version (docs/design/47-bring-your-own-database.md D11, task T11).</summary>
public sealed class StoreRouteSharingTests
{
    private static readonly Guid BabyId = Guid.Parse("b0000000-0000-4000-8000-0000000000aa");

    [Fact]
    public void BuiltInStore_AllowsOtherPeople()
    {
        Assert.True(StoreRoute.BuiltInDefault.AllowsOtherPeople);
        StoreRoute.BuiltInDefault.EnsureAllowsOtherPeople(BabyId);
        Assert.True(new StoreRoute(DataStoreKey.BuiltIn, 3).AllowsOtherPeople);
    }

    [Fact]
    public void ExternalStore_IsOwnerOnly_StoreOwnerOnly()
    {
        var route = new StoreRoute(DataStoreKey.External(Guid.NewGuid()), 1);

        var error = Assert.Throws<StoreOwnerOnlyException>(() => route.EnsureAllowsOtherPeople(BabyId));

        Assert.False(route.AllowsOtherPeople);
        Assert.Equal(("store_owner_only", BabyId), (error.Code, error.BabyId));
    }
}
