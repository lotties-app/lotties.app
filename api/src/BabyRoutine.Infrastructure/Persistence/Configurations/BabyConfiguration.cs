using BabyRoutine.Domain.Babies;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BabyRoutine.Infrastructure.Persistence.Configurations;

/// <remarks>
/// The baby and its members are one aggregate guarded by the baby row's <c>xmin</c> row version
/// (<see cref="RowVersions"/>); the baby repository rewrites the baby row whenever its members change, so concurrent
/// member changes (e.g. two owners demoting each other) conflict instead of both passing the last-owner rule.
/// </remarks>
internal sealed class BabyConfiguration : IEntityTypeConfiguration<Baby>
{
    public void Configure(EntityTypeBuilder<Baby> builder)
    {
        builder.ToTable("babies");
        builder.HasXminRowVersion();
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
