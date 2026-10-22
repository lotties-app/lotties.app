using Lotties.Domain.Babies;
using Lotties.Domain.Measurements;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

internal sealed class MeasurementConfiguration : IEntityTypeConfiguration<Measurement>
{
    public void Configure(EntityTypeBuilder<Measurement> builder)
    {
        builder.ToTable("measurements");
        builder.HasKey(measurement => measurement.Id);
        builder.Property(measurement => measurement.Id).ValueGeneratedNever();
        builder.Property(measurement => measurement.Date).IsRequired();
        builder.Property(measurement => measurement.WeightKg).HasPrecision(6, 2);
        builder.Property(measurement => measurement.HeightCm).HasPrecision(6, 2);
        builder.Property(measurement => measurement.HeadCircumferenceCm).HasPrecision(6, 2);
        builder.Property(measurement => measurement.Notes).HasMaxLength(Measurement.NotesMaxLength);
        builder.Property(measurement => measurement.CreatedAt).IsRequired();
        builder.Property(measurement => measurement.UpdatedAt).IsRequired();
        builder.Property(measurement => measurement.RecordedByDoctor).IsRequired();
        builder.HasIndex(measurement => new { measurement.BabyId, measurement.Date });
        builder.HasOne<Baby>().WithMany().HasForeignKey(measurement => measurement.BabyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(measurement => measurement.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
