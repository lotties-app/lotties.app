using Lotties.Domain.Medications;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

internal sealed class MedicationConfiguration : IEntityTypeConfiguration<Medication>
{
    public void Configure(EntityTypeBuilder<Medication> builder)
    {
        builder.ToTable("medications");
        builder.HasKey(medication => medication.Id);
        builder.Property(medication => medication.Id).ValueGeneratedNever();
        builder.Property(medication => medication.Name).HasMaxLength(Medication.NameMaxLength).IsRequired();
        builder.Property(medication => medication.Notes).HasMaxLength(Medication.NotesMaxLength);
        builder.Property(medication => medication.CreatedAt).IsRequired();
        builder.OwnsOne(medication => medication.DefaultDosage, dosage =>
        {
            dosage.Property(value => value.Amount).HasPrecision(10, 3).HasColumnName("default_dose_amount");
            dosage.Property(value => value.Unit).HasMaxLength(Dosage.UnitMaxLength).HasColumnName("default_dose_unit");
        });
        builder.HasIndex(medication => medication.BabyId);
        builder.HasIndex(medication => medication.ProductId);
    }
}
