using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// One row per user (migration <c>VoiceAssistants</c>), created on the first <c>PUT /me/assistant-settings</c>. The default
/// baby is a plain choice, re-checked against the memberships on every command: removing the baby sets it to NULL.
/// </remarks>
internal sealed class UserAssistantSettingsConfiguration : IEntityTypeConfiguration<UserAssistantSettings>
{
    public void Configure(EntityTypeBuilder<UserAssistantSettings> builder)
    {
        builder.ToTable("user_assistant_settings");
        builder.HasKey(settings => settings.UserId);
        builder.Property(settings => settings.UserId).ValueGeneratedNever();
        builder.Property(settings => settings.DefaultBabyId);
        builder.Property(settings => settings.SayBabyName).IsRequired().HasDefaultValue(false);
        builder.Property(settings => settings.UpdatedAt).IsRequired();
        builder.HasIndex(settings => settings.DefaultBabyId);
        builder.HasOne<User>().WithOne().HasForeignKey<UserAssistantSettings>(settings => settings.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Baby>().WithMany().HasForeignKey(settings => settings.DefaultBabyId).OnDelete(DeleteBehavior.SetNull);
    }
}
