using Lotties.Domain.Units;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// One row per user (migration <c>UnitSettings</c>), created on the first <c>PUT /me/unit-settings</c>: the setting as its wire
/// name (<c>auto</c>, <c>metric</c>, <c>us</c>). It is a user-level choice, so it dies with the user row (cascade) and is
/// erased with the account.
/// </remarks>
internal sealed class UserUnitSettingsConfiguration : IEntityTypeConfiguration<UserUnitSettings>
{
    public void Configure(EntityTypeBuilder<UserUnitSettings> builder)
    {
        builder.ToTable("user_unit_settings");
        builder.HasKey(settings => settings.UserId);
        builder.Property(settings => settings.UserId).ValueGeneratedNever();
        builder.Property(settings => settings.Setting)
            .HasConversion(
                setting => UnitSystems.NameOf(setting),
                name => UnitSystems.ParseOrAuto(name))
            .HasMaxLength(8)
            .IsRequired();
        builder.Property(settings => settings.UpdatedAt).IsRequired();
        builder.HasOne<User>().WithOne().HasForeignKey<UserUnitSettings>(settings => settings.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
