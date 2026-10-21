using Lotties.Domain.Notifications;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence.Converters;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>One row per user, created on the first <c>PUT /push/settings</c>; before that the domain defaults apply.</remarks>
internal sealed class UserNotificationSettingsConfiguration : IEntityTypeConfiguration<UserNotificationSettings>
{
    public void Configure(EntityTypeBuilder<UserNotificationSettings> builder)
    {
        builder.ToTable("user_notification_settings");
        builder.HasKey(settings => settings.UserId);
        builder.Property(settings => settings.UserId).ValueGeneratedNever();
        builder.Property(settings => settings.TimeZone)
            .HasConversion(NotificationConverters.TimeZone)
            .HasMaxLength(NotificationTimeZone.MaxLength)
            .IsRequired();
        builder.Property(settings => settings.QuietHoursEnabled).IsRequired();
        builder.Property(settings => settings.QuietStart).IsRequired();
        builder.Property(settings => settings.QuietEnd).IsRequired();
        builder.Property(settings => settings.QuietIncludesMedicine).IsRequired();
        builder.Property(settings => settings.ShowNames).IsRequired();
        builder.Property(settings => settings.UpdatedAt).IsRequired();
        builder.Ignore(settings => settings.QuietHours);
        builder.Ignore(settings => settings.Terms);
        builder.HasOne<User>().WithOne().HasForeignKey<UserNotificationSettings>(settings => settings.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
