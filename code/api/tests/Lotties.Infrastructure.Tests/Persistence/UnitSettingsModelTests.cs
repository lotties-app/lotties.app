using Lotties.Domain.Units;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model checks of <c>user_unit_settings</c> (migration <c>UnitSettings</c>).</summary>
public sealed class UnitSettingsModelTests
{
    [Fact]
    public void UserUnitSettings_OneRowPerUserStoredAsItsWireName()
    {
        using var context = ModelTestContext.Create();
        var settings = context.Entity<UserUnitSettings>();

        var userKey = settings.GetForeignKeys().Single();
        var setting = settings.FindProperty(nameof(UserUnitSettings.Setting))!;

        Assert.Equal("user_unit_settings", settings.GetTableName());
        Assert.Equal(["user_id"], settings.FindPrimaryKey()!.Properties.Select(property => property.GetColumnName()));
        Assert.Equal(DeleteBehavior.Cascade, userKey.DeleteBehavior);
        Assert.False(setting.IsNullable);
        Assert.Equal("setting", setting.GetColumnName());
        Assert.Equal("us", setting.GetValueConverter()!.ConvertToProvider(UnitSetting.Us));
        Assert.Equal(UnitSetting.Metric, setting.GetValueConverter()!.ConvertFromProvider("metric"));
        Assert.Equal(UnitSetting.Auto, setting.GetValueConverter()!.ConvertFromProvider("anything else"));
    }
}
