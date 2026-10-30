using Lotties.Domain.Assistants;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model checks of <c>user_assistant_settings</c> (migration <c>VoiceAssistants</c>).</summary>
public sealed class AssistantSettingsModelTests
{
    [Fact]
    public void UserAssistantSettings_OneRowPerUserWithANullableDefaultBaby()
    {
        using var context = ModelTestContext.Create();
        var settings = context.Entity<UserAssistantSettings>();

        var babyKey = settings.GetForeignKeys().Single(key => key.Properties[0].Name == nameof(UserAssistantSettings.DefaultBabyId));
        var userKey = settings.GetForeignKeys().Single(key => key.Properties[0].Name == nameof(UserAssistantSettings.UserId));

        Assert.Equal("user_assistant_settings", settings.GetTableName());
        Assert.Equal(["user_id"], settings.FindPrimaryKey()!.Properties.Select(property => property.GetColumnName()));
        Assert.True(settings.FindProperty(nameof(UserAssistantSettings.DefaultBabyId))!.IsNullable);
        Assert.Equal(DeleteBehavior.SetNull, babyKey.DeleteBehavior);
        Assert.Equal(DeleteBehavior.Cascade, userKey.DeleteBehavior);
    }

    [Fact]
    public void SayMedicineNames_IsARequiredColumnThatDefaultsToFalse()
    {
        using var context = ModelTestContext.Create();
        var property = context.Entity<UserAssistantSettings>().FindProperty(nameof(UserAssistantSettings.SayMedicineNames))!;

        Assert.Equal("say_medicine_names", property.GetColumnName());
        Assert.False(property.IsNullable);
        Assert.Equal(false, property.GetDefaultValue());
    }

    [Fact]
    public void SayBabyName_IsARequiredColumnThatDefaultsToFalse()
    {
        using var context = ModelTestContext.Create();
        var property = context.Entity<UserAssistantSettings>().FindProperty(nameof(UserAssistantSettings.SayBabyName))!;

        Assert.Equal("say_baby_name", property.GetColumnName());
        Assert.False(property.IsNullable);
        Assert.Equal(false, property.GetDefaultValue());
    }
}
