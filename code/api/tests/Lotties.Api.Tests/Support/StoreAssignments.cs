using Lotties.Domain.Stores;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Support;

/// <summary>Points a baby at an external data store, as moving it will (docs/design/47-bring-your-own-database.md, task T7).</summary>
internal static class StoreAssignments
{
    /// <summary>
    /// A <c>data_stores</c> row <paramref name="storeId"/> owned by <paramref name="ownerId"/> and the baby's pointer to it (epoch 1).
    /// The store need not be one the host can open.
    /// </summary>
    public static Task AssignStoreAsync(this ApiFactory factory, Guid babyId, Guid ownerId, Guid storeId) =>
        factory.SeedAsync(async context =>
        {
            context.DataStores.Add(DataStore.Create(storeId, ownerId, TestUsers.Now));
            var assignment = await context.BabyStoreAssignments.SingleAsync(row => row.BabyId == babyId);
            assignment.MoveTo(DataStoreKey.External(storeId));
        });
}
