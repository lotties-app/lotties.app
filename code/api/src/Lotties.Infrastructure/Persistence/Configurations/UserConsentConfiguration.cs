using Lotties.Domain.Consents;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// <c>user_consents</c> (migration <c>Consent</c>): the current consent of one kind per user, key <c>(user_id, kind)</c>. Kind, capacity
/// and the history's action are stored as their wire names (text). User-level data: it dies with the user row (cascade) and is erased
/// with the account (docs/design/38-consent-and-terms.md).
/// </remarks>
internal sealed class UserConsentConfiguration : IEntityTypeConfiguration<UserConsent>
{
    public void Configure(EntityTypeBuilder<UserConsent> builder)
    {
        builder.ToTable("user_consents");
        builder.HasKey(consent => new { consent.UserId, consent.Kind });
        builder.Property(consent => consent.UserId).ValueGeneratedNever();
        builder.Property(consent => consent.Kind)
            .HasConversion(kind => ConsentKinds.NameOf(kind), name => ConsentKinds.ParseOrCore(name))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(consent => consent.Version).HasMaxLength(32).IsRequired();
        builder.Property(consent => consent.AcceptedAt).IsRequired();
        builder.Property(consent => consent.WithdrawnAt);
        builder.Property(consent => consent.Capacity)
            .HasConversion(
                capacity => capacity == null ? null : ConsentCapacities.NameOf(capacity.Value),
                name => name == null ? null : ConsentCapacities.ParseOrAuthorised(name))
            .HasMaxLength(16);
        builder.Property(consent => consent.Locale).HasMaxLength(UserConsent.MaxLocaleLength).IsRequired();
        builder.Ignore(consent => consent.IsGranted);
        builder.HasOne<User>().WithMany().HasForeignKey(consent => consent.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <remarks>
/// <c>user_consent_history</c> (migration <c>Consent</c>): one line per grant or withdrawal, append-only, so the service can show which
/// version a person consented to and when. Erased with the account.
/// </remarks>
internal sealed class UserConsentHistoryConfiguration : IEntityTypeConfiguration<UserConsentHistoryEntry>
{
    public void Configure(EntityTypeBuilder<UserConsentHistoryEntry> builder)
    {
        builder.ToTable("user_consent_history");
        builder.HasKey(entry => entry.Id);
        builder.Property(entry => entry.Id).ValueGeneratedNever();
        builder.Property(entry => entry.UserId).IsRequired();
        builder.Property(entry => entry.Kind)
            .HasConversion(kind => ConsentKinds.NameOf(kind), name => ConsentKinds.ParseOrCore(name))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(entry => entry.Action)
            .HasConversion(action => action == ConsentAction.Granted ? "granted" : "withdrawn", name => name == "granted" ? ConsentAction.Granted : ConsentAction.Withdrawn)
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(entry => entry.Version).HasMaxLength(32).IsRequired();
        builder.Property(entry => entry.At).IsRequired();
        builder.Property(entry => entry.Capacity)
            .HasConversion(
                capacity => capacity == null ? null : ConsentCapacities.NameOf(capacity.Value),
                name => name == null ? null : ConsentCapacities.ParseOrAuthorised(name))
            .HasMaxLength(16);
        builder.Property(entry => entry.Locale).HasMaxLength(UserConsent.MaxLocaleLength).IsRequired();
        builder.HasIndex(entry => new { entry.UserId, entry.At });
        builder.HasOne<User>().WithMany().HasForeignKey(entry => entry.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
