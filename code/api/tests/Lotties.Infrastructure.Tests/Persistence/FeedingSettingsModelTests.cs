using Lotties.Domain.FeedingPreferences;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model checks of <c>user_feeding_settings</c> (migration <c>FeedingSettings</c>).</summary>
public sealed class FeedingSettingsModelTests
{
    [Fact]
    public void UserFeedingSettings_OneRowPerUserWithARequiredFlagDefaultingToOff()
    {
        using var context = ModelTestContext.Create();
        var settings = context.Entity<UserFeedingSettings>();

        var userKey = settings.GetForeignKeys().Single();
        var flag = settings.FindProperty(nameof(UserFeedingSettings.TimeBottleFeedings))!;

        Assert.Equal("user_feeding_settings", settings.GetTableName());
        Assert.Equal(["user_id"], settings.FindPrimaryKey()!.Properties.Select(property => property.GetColumnName()));
        Assert.Equal(DeleteBehavior.Cascade, userKey.DeleteBehavior);
        Assert.False(flag.IsNullable);
        Assert.Equal("time_bottle_feedings", flag.GetColumnName());
        Assert.Equal(false, flag.GetDefaultValue());
    }
}
