using Lotties.Domain.FeedingPreferences;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// One row per user (migration <c>FeedingSettings</c>), created on the first <c>PUT /me/feeding-settings</c>. A user-level choice,
/// so it dies with the user row (cascade) and is erased with the account.
/// </remarks>
internal sealed class UserFeedingSettingsConfiguration : IEntityTypeConfiguration<UserFeedingSettings>
{
    public void Configure(EntityTypeBuilder<UserFeedingSettings> builder)
    {
        builder.ToTable("user_feeding_settings");
        builder.HasKey(settings => settings.UserId);
        builder.Property(settings => settings.UserId).ValueGeneratedNever();
        builder.Property(settings => settings.TimeBottleFeedings).IsRequired().HasDefaultValue(false);
        builder.Property(settings => settings.UpdatedAt).IsRequired();
        builder.HasOne<User>().WithOne().HasForeignKey<UserFeedingSettings>(settings => settings.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
