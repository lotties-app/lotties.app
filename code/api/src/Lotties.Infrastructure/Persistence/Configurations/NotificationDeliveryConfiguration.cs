using Lotties.Domain.Notifications;
using Lotties.Infrastructure.Persistence.Converters;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// The delivery log and the idempotency claim: the unique <c>(subscription_id, dedupe_key)</c> index makes a second
/// claim of the same notification for the same device fail with a unique violation (another tick or instance won).
/// <c>user_id</c> and <c>baby_id</c> are denormalised without foreign keys (snooze lookups; <c>baby_id</c> is null for tests).
/// </remarks>
internal sealed class NotificationDeliveryConfiguration : IEntityTypeConfiguration<NotificationDelivery>
{
    public const int KindMaxLength = 24;
    public const int StatusMaxLength = 12;

    public void Configure(EntityTypeBuilder<NotificationDelivery> builder)
    {
        builder.ToTable("notification_deliveries");
        builder.HasKey(delivery => delivery.Id);
        builder.Property(delivery => delivery.Id).ValueGeneratedNever();
        builder.Property(delivery => delivery.Kind).HasConversion(NotificationConverters.Kind).HasMaxLength(KindMaxLength).IsRequired();
        builder.Property(delivery => delivery.BaseKey)
            .HasConversion(NotificationConverters.Key)
            .HasMaxLength(NotificationKey.BaseMaxLength)
            .IsRequired();
        builder.Property(delivery => delivery.DedupeKey)
            .HasConversion(NotificationConverters.Key)
            .HasMaxLength(NotificationKey.MaxLength)
            .IsRequired();
        builder.Property(delivery => delivery.DueAt).IsRequired();
        builder.Property(delivery => delivery.ExpiresAt).IsRequired();
        builder.Property(delivery => delivery.Status)
            .HasConversion(NotificationConverters.DeliveryStatus)
            .HasMaxLength(StatusMaxLength)
            .IsRequired();
        builder.Property(delivery => delivery.Attempts).IsRequired();
        builder.Property(delivery => delivery.ActionTokenHash)
            .HasConversion(NotificationConverters.ActionTokenHash)
            .HasMaxLength(PushSubscriptionConfiguration.HashLength)
            .IsFixedLength();
        builder.Property(delivery => delivery.CreatedAt).IsRequired();
        builder.HasIndex(delivery => new { delivery.SubscriptionId, delivery.DedupeKey }).IsUnique();
        builder.HasIndex(delivery => new { delivery.Status, delivery.NextAttemptAt });
        builder.HasIndex(delivery => delivery.CreatedAt);
        builder.HasIndex(delivery => new { delivery.UserId, delivery.BaseKey });
        builder.HasOne<PushSubscription>().WithMany().HasForeignKey(delivery => delivery.SubscriptionId).OnDelete(DeleteBehavior.Cascade);
    }
}
