using Lotties.Domain.Babies;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>
/// Model checks of migration <c>DataStores</c> (docs/design/47-bring-your-own-database.md, task T2): the control table
/// <c>data_stores</c> and the baby's routing columns, mapped beside <see cref="Baby"/> so the baby's own queries are unchanged.
/// </summary>
public sealed class DataStoresModelTests
{
    [Fact]
    public void DataStores_ControlTableOwnedByAnAccountWithANullableSealedDescriptor()
    {
        using var context = ModelTestContext.Create();
        var stores = context.Entity<DataStore>();

        var owner = stores.GetForeignKeys().Single();

        Assert.Equal("data_stores", stores.GetTableName());
        Assert.Equal(["id"], stores.FindPrimaryKey()!.Properties.Select(property => property.GetColumnName()));
        Assert.Equal((typeof(User), "owner_user_id", DeleteBehavior.Restrict), (owner.PrincipalEntityType.ClrType, owner.Properties.Single().GetColumnName(), owner.DeleteBehavior));
        Assert.Contains(stores.GetIndexes(), index => index.Properties.Single().Name == nameof(DataStore.OwnerUserId));
        Assert.True(stores.FindProperty(nameof(DataStore.SealedDescriptor))!.IsNullable);
        Assert.Equal(("state", 32, false), (stores.FindProperty(nameof(DataStore.State))!.GetColumnName(), stores.FindProperty(nameof(DataStore.State))!.GetMaxLength(), stores.FindProperty(nameof(DataStore.State))!.IsNullable));
    }

    [Fact]
    public void DataStores_HaveTheDisplayAndLastTestColumns()
    {
        using var context = ModelTestContext.Create();
        var stores = context.Entity<DataStore>();

        var label = stores.FindProperty(nameof(DataStore.ProviderLabel))!;
        var result = stores.FindProperty(nameof(DataStore.LastCheckResult))!;
        var checkedAt = stores.FindProperty(nameof(DataStore.LastCheckedAt))!;

        Assert.Equal(("provider_label", 64, true), (label.GetColumnName(), label.GetMaxLength(), label.IsNullable));
        Assert.Equal(("last_check_result", 48, true), (result.GetColumnName(), result.GetMaxLength(), result.IsNullable));
        Assert.Equal(("last_checked_at", true), (checkedAt.GetColumnName(), checkedAt.IsNullable));
        Assert.Null(stores.FindProperty(nameof(DataStore.HasDescriptor)));
    }

    [Fact]
    public void BabyStoreAssignment_IsTheRoutingColumnsOfTheBabyRow()
    {
        using var context = ModelTestContext.Create();
        var assignment = context.Entity<BabyStoreAssignment>();

        var pointer = assignment.GetForeignKeys().Single(key => key.PrincipalEntityType.ClrType == typeof(DataStore));
        var epoch = assignment.FindProperty(nameof(BabyStoreAssignment.Epoch))!;

        Assert.Equal("babies", assignment.GetTableName());
        Assert.Equal(["id"], assignment.FindPrimaryKey()!.Properties.Select(property => property.GetColumnName()));
        Assert.Equal(("data_store_id", true, DeleteBehavior.Restrict), (pointer.Properties.Single().GetColumnName(), pointer.Properties.Single().IsNullable, pointer.DeleteBehavior));
        Assert.Equal(("store_epoch", 0), (epoch.GetColumnName(), epoch.GetDefaultValue()));
        Assert.Contains(assignment.GetForeignKeys(), key => key.PrincipalEntityType.ClrType == typeof(Baby) && key.IsUnique);
        Assert.Contains(assignment.GetCheckConstraints(), check => (check.Name, check.Sql) == ("ck_babies_store_epoch_present", "store_epoch IS NOT NULL"));
    }

    [Fact]
    public void Baby_DoesNotMapTheRoutingColumns_SoItsQueriesReadWhatTheyReadBefore()
    {
        using var context = ModelTestContext.Create();

        var columns = context.Entity<Baby>().GetProperties().Select(property => property.GetColumnName()).ToArray();

        Assert.DoesNotContain("data_store_id", columns);
        Assert.DoesNotContain("store_epoch", columns);
    }

    [Fact]
    public void DataContext_DoesNotMapTheControlTablesOfTheStores()
    {
        using var data = ModelTestContext.CreateData();

        Assert.Null(data.DesignTimeModel().FindEntityType(typeof(DataStore)));
        Assert.Null(data.DesignTimeModel().FindEntityType(typeof(BabyStoreAssignment)));
    }
}
