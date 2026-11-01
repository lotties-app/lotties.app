using Lotties.Domain.Rest;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model checks of <c>user_rest_settings</c> and <c>user_rest_mornings</c> (migration <c>CaregiverRest</c>).</summary>
public sealed class RestSettingsModelTests
{
    [Fact]
    public void UserRestSettings_OneRowPerUser_WorkWindowsAreJsonb()
    {
        using var context = ModelTestContext.Create();
        var settings = context.Entity<UserRestSettings>();

        var windows = settings.FindProperty(nameof(UserRestSettings.WorkWindows))!;

        Assert.Equal("user_rest_settings", settings.GetTableName());
        Assert.Equal(["user_id"], settings.FindPrimaryKey()!.Properties.Select(property => property.GetColumnName()));
        Assert.Equal(DeleteBehavior.Cascade, settings.GetForeignKeys().Single().DeleteBehavior);
        Assert.Equal("work_windows", windows.GetColumnName());
        Assert.Equal("jsonb", windows.GetColumnType());
        Assert.False(windows.IsNullable);
        foreach (var name in new[] { "enabled", "time_zone", "night_start", "night_end", "fall_asleep_minutes", "wake_lead_minutes", "updated_at" })
        {
            Assert.Contains(settings.GetProperties(), property => property.GetColumnName() == name && !property.IsNullable);
        }
    }

    [Fact]
    public void WorkWindows_RoundTripThroughTheirJson()
    {
        using var context = ModelTestContext.Create();
        var converter = context.Entity<UserRestSettings>().FindProperty(nameof(UserRestSettings.WorkWindows))!.GetValueConverter()!;
        IReadOnlyList<StoredWorkWindow> windows = [new([1, 2], new TimeOnly(22, 0), new TimeOnly(6, 30))];

        var json = (string)converter.ConvertToProvider(windows)!;
        var back = (IReadOnlyList<StoredWorkWindow>)converter.ConvertFromProvider(json)!;

        Assert.Equal("""[{"days":[1,2],"start":"22:00","end":"06:30"}]""", json);
        Assert.True(windows.SequenceEqual(back));
    }

    [Fact]
    public void UserRestMornings_KeyedByUserAndNight()
    {
        using var context = ModelTestContext.Create();
        var mornings = context.Entity<UserRestMorning>();

        Assert.Equal("user_rest_mornings", mornings.GetTableName());
        Assert.Equal(["user_id", "night"], mornings.FindPrimaryKey()!.Properties.Select(property => property.GetColumnName()));
        Assert.Equal(DeleteBehavior.Cascade, mornings.GetForeignKeys().Single().DeleteBehavior);
        Assert.Contains(mornings.GetProperties(), property => property.GetColumnName() == "up_at" && !property.IsNullable);
    }
}
