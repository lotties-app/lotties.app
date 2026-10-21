using BabyRoutine.Domain.Notifications;
using BabyRoutine.Domain.Users;
using BabyRoutine.Infrastructure.Persistence.Converters;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BabyRoutine.Infrastructure.Persistence.Configurations;

/// <remarks>
/// One row per browser endpoint, looked up by the unique <c>endpoint_hash</c> (SHA-256 base64url, 43 characters); the
/// endpoint itself is a capability URL that is never indexed, logged or returned. Revocation is soft; the filtered
/// <c>user_id</c> index serves the active devices of a user.
/// </remarks>
internal sealed class PushSubscriptionConfiguration : IEntityTypeConfiguration<PushSubscription>
{
    public const int HashLength = 43;
    public const int RevokedReasonMaxLength = 16;
    public const string ActiveFilter = "revoked_at IS NULL";

    public void Configure(EntityTypeBuilder<PushSubscription> builder)
    {
        builder.ToTable("push_subscriptions");
        builder.HasKey(subscription => subscription.Id);
        builder.Property(subscription => subscription.Id).ValueGeneratedNever();
        builder.Property(subscription => subscription.Endpoint)
            .HasConversion(NotificationConverters.Endpoint)
            .HasMaxLength(PushEndpoint.MaxLength)
            .IsRequired();
        builder.Property(subscription => subscription.EndpointHash).HasMaxLength(HashLength).IsFixedLength().IsRequired();
        builder.ComplexProperty(subscription => subscription.Keys, ConfigureKeys);
        builder.Property(subscription => subscription.Locale)
            .HasConversion(NotificationConverters.Locale)
            .HasMaxLength(NotificationLocale.MaxLength)
            .IsRequired();
        builder.Property(subscription => subscription.DeviceLabel).HasMaxLength(PushSubscription.DeviceLabelMaxLength);
        builder.Property(subscription => subscription.CreatedAt).IsRequired();
        builder.Property(subscription => subscription.LastSeenAt).IsRequired();
        builder.Property(subscription => subscription.ConsecutiveFailures).IsRequired();
        builder.Property(subscription => subscription.RevokedReason)
            .HasConversion(NotificationConverters.RevokeReason)
            .HasMaxLength(RevokedReasonMaxLength);
        builder.Ignore(subscription => subscription.IsRevoked);
        builder.HasIndex(subscription => subscription.EndpointHash).IsUnique();
        builder.HasIndex(subscription => subscription.UserId).HasFilter(ActiveFilter);
        builder.HasOne<User>().WithMany().HasForeignKey(subscription => subscription.UserId).OnDelete(DeleteBehavior.Cascade);
    }

    private static void ConfigureKeys(ComplexPropertyBuilder<PushKeys> keys)
    {
        keys.Property(value => value.P256dh).HasMaxLength(PushKeys.P256dhMaxLength).HasColumnName("p256dh").IsRequired();
        keys.Property(value => value.Auth).HasMaxLength(PushKeys.AuthMaxLength).HasColumnName("auth").IsRequired();
    }
}
