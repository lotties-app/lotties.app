using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// Users are unique by <c>(issuer, subject)</c>. Migration <c>Wave2Hardening</c> added <c>issuer</c> with
/// <see cref="User.UnknownIssuer"/> for existing rows; the first sign-in of such a user records the token issuer.
/// </remarks>
internal sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("users");
        builder.HasKey(user => user.Id);
        builder.Property(user => user.Id).ValueGeneratedNever();
        builder.Property(user => user.Issuer).HasMaxLength(User.IssuerMaxLength).IsRequired();
        builder.Property(user => user.Subject).HasMaxLength(User.SubjectMaxLength).IsRequired();
        builder.Property(user => user.DisplayName).HasMaxLength(User.DisplayNameMaxLength).IsRequired();
        builder.Property(user => user.RoleLabel).HasMaxLength(RoleLabels.MaxLength);
        builder.Property(user => user.CreatedAt).IsRequired();
        builder.Property(user => user.DeletedAt);
        builder.Property(user => user.DemoExpiresAt);
        builder.HasIndex(user => new { user.Issuer, user.Subject }).IsUnique();
        builder.HasIndex(user => user.DemoExpiresAt).HasDatabaseName("ix_users_demo_expires_at");
    }
}
