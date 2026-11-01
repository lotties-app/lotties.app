using Lotties.Domain.Notifications;
using Lotties.Infrastructure.Persistence.Converters;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>A user's snooze or dismissal of one reminder, keyed by <c>(user_id, base_key)</c>; purged 7 days after its last change.</remarks>
internal sealed class NotificationActionConfiguration : IEntityTypeConfiguration<NotificationAction>
{
    public const int ActionMaxLength = 10;

    public void Configure(EntityTypeBuilder<NotificationAction> builder)
    {
        builder.ToTable("notification_actions");
        builder.HasKey(action => new { action.UserId, action.BaseKey });
        builder.Property(action => action.BaseKey)
            .HasConversion(NotificationConverters.Key)
            .HasMaxLength(NotificationKey.BaseMaxLength);
        builder.Property(action => action.BabyId).IsRequired();
        builder.Property(action => action.Action)
            .HasConversion(NotificationConverters.ActionKind)
            .HasMaxLength(ActionMaxLength)
            .IsRequired();
        builder.Property(action => action.SnoozeCount).IsRequired();
        builder.Property(action => action.UpdatedAt).IsRequired();
        builder.Ignore(action => action.SnoozeResendKey);
    }
}
