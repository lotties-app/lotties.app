using Lotties.Domain.Babies;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence.Converters;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

internal sealed class BabyMemberConfiguration : IEntityTypeConfiguration<BabyMember>
{
    public const int RoleMaxLength = 16;

    public void Configure(EntityTypeBuilder<BabyMember> builder)
    {
        builder.ToTable("baby_members");
        builder.HasKey(member => member.Id);
        builder.Property(member => member.Id).ValueGeneratedNever();
        builder.Property(member => member.Role).HasConversion<string>().HasMaxLength(RoleMaxLength).IsRequired();
        builder.Property(member => member.JoinedAt).IsRequired();
        builder.Property(member => member.DoctorScopes)
            .HasConversion(ValueObjectConverters.DoctorScopes)
            .HasMaxLength(DoctorScopeSet.StorageMaxLength);
        builder.HasIndex(member => new { member.BabyId, member.UserId }).IsUnique();
        builder.HasIndex(member => member.UserId);
        builder.HasOne<User>().WithMany().HasForeignKey(member => member.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}
