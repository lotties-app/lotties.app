using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Users;
using BabyRoutine.Infrastructure.Persistence.Converters;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BabyRoutine.Infrastructure.Persistence.Configurations;

internal sealed class InviteConfiguration : IEntityTypeConfiguration<Invite>
{
    public void Configure(EntityTypeBuilder<Invite> builder)
    {
        builder.ToTable("invites");
        builder.HasKey(invite => invite.Id);
        builder.Property(invite => invite.Id).ValueGeneratedNever();
        builder.Property(invite => invite.Token)
            .HasConversion(ValueObjectConverters.InviteToken)
            .HasMaxLength(InviteToken.MaxLength)
            .IsRequired();
        builder.Property(invite => invite.Role)
            .HasConversion<string>()
            .HasMaxLength(BabyMemberConfiguration.RoleMaxLength)
            .IsRequired();
        builder.Property(invite => invite.CreatedAt).IsRequired();
        builder.Property(invite => invite.ExpiresAt).IsRequired();
        builder.HasIndex(invite => invite.Token).IsUnique();
        builder.HasIndex(invite => invite.BabyId);
        builder.HasOne<Baby>().WithMany().HasForeignKey(invite => invite.BabyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<User>().WithMany().HasForeignKey(invite => invite.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(invite => invite.AcceptedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
