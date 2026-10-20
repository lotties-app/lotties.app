using BabyRoutine.Domain.Babies;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BabyRoutine.Infrastructure.Persistence.Configurations;

internal sealed class BabyConfiguration : IEntityTypeConfiguration<Baby>
{
    public void Configure(EntityTypeBuilder<Baby> builder)
    {
        builder.ToTable("babies");
        builder.HasKey(baby => baby.Id);
        builder.Property(baby => baby.Id).ValueGeneratedNever();
        builder.Property(baby => baby.Name).HasMaxLength(Baby.NameMaxLength).IsRequired();
        builder.Property(baby => baby.BirthDate).IsRequired();
        builder.Property(baby => baby.CreatedAt).IsRequired();
        builder.HasMany(baby => baby.Members)
            .WithOne()
            .HasForeignKey(member => member.BabyId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(baby => baby.Members).UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
