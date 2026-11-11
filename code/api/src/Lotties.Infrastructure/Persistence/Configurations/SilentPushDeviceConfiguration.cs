using Lotties.Domain.Notifications;
using Lotties.Domain.SilentPush;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence.Converters;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// One row per push service token (docs/design/37b-widget-silent-push.md section 4.1), looked up by the unique
/// <c>token_hash</c> (SHA-256 base64url, 43 characters); the token is a device identifier that is never indexed, logged or
/// returned. Revocation is soft; the filtered <c>user_id</c> index serves a user's active devices and the recipients
/// query. The user's account deletion cascades (and <c>EfAccountDataEraser</c> deletes the rows first).
/// </remarks>
internal sealed class SilentPushDeviceConfiguration : IEntityTypeConfiguration<SilentPushDevice>
{
    public const int ChannelMaxLength = 8;
    public const int EnvironmentMaxLength = 16;

    private static readonly ValueConverter<SilentPushChannel, string> Channel =
        new(channel => SilentPushCodes.Of(channel), code => ParseChannel(code));

    private static readonly ValueConverter<ApnsEnvironment, string> Environment =
        new(environment => SilentPushCodes.Of(environment), code => ParseEnvironment(code));

    public void Configure(EntityTypeBuilder<SilentPushDevice> builder)
    {
        builder.ToTable("silent_push_devices");
        builder.HasKey(device => device.Id);
        builder.Property(device => device.Id).ValueGeneratedNever();
        builder.Property(device => device.Channel).HasConversion(Channel).HasMaxLength(ChannelMaxLength).IsRequired();
        builder.Property(device => device.Token).HasMaxLength(SilentPushToken.MaxLength).IsRequired();
        builder.Property(device => device.TokenHash).HasMaxLength(PushSubscriptionConfiguration.HashLength).IsFixedLength().IsRequired();
        builder.Property(device => device.ApnsEnvironment).HasConversion(Environment).HasMaxLength(EnvironmentMaxLength);
        builder.Property(device => device.CreatedAt).IsRequired();
        builder.Property(device => device.LastSeenAt).IsRequired();
        builder.Property(device => device.ConsecutiveFailures).IsRequired();
        builder.Property(device => device.RevokedReason)
            .HasConversion(NotificationConverters.RevokeReason)
            .HasMaxLength(PushSubscriptionConfiguration.RevokedReasonMaxLength);
        builder.Ignore(device => device.IsRevoked);
        builder.HasIndex(device => device.TokenHash).IsUnique();
        builder.HasIndex(device => device.UserId).HasFilter(PushSubscriptionConfiguration.ActiveFilter);
        builder.HasOne<User>().WithMany().HasForeignKey(device => device.UserId).OnDelete(DeleteBehavior.Cascade);
    }

    private static SilentPushChannel ParseChannel(string code) =>
        SilentPushCodes.TryParse(code, out SilentPushChannel channel) ? channel : throw new InvalidOperationException($"Stored silent push channel '{code}' is unknown.");

    private static ApnsEnvironment ParseEnvironment(string code) =>
        SilentPushCodes.TryParse(code, out ApnsEnvironment environment) ? environment : throw new InvalidOperationException($"Stored APNs environment '{code}' is unknown.");
}
