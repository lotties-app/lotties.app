using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Medications;
using BabyRoutine.Domain.Prescriptions;
using BabyRoutine.Domain.Users;
using BabyRoutine.Infrastructure.Persistence.Converters;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BabyRoutine.Infrastructure.Persistence.Configurations;

/// <remarks>
/// <c>medication_id</c> has no foreign key on purpose: a medication is hard deleted (its prescriptions are soft deleted
/// first, so clients learn about it through the delta), and soft-deleted prescriptions keep the id like events keep a
/// copy of the medication in their payload. Soft-deleted rows are returned by every read (delta sync), so there is no
/// global query filter.
/// </remarks>
internal sealed class PrescriptionConfiguration : IEntityTypeConfiguration<Prescription>
{
    public const int EnumMaxLength = 16;
    public const int TimesOfDayMaxLength = TimesOfDay.MaxCount * 6;

    public void Configure(EntityTypeBuilder<Prescription> builder)
    {
        builder.ToTable("prescriptions");
        builder.HasKey(prescription => prescription.Id);
        builder.Property(prescription => prescription.Id).ValueGeneratedNever();
        builder.Property(prescription => prescription.Status).HasConversion<string>().HasMaxLength(EnumMaxLength).IsRequired();
        builder.OwnsOne(prescription => prescription.Dose, ConfigureDose);
        builder.Navigation(prescription => prescription.Dose).IsRequired();
        builder.OwnsOne(prescription => prescription.Schedule, ConfigureSchedule);
        builder.Navigation(prescription => prescription.Schedule).IsRequired();
        builder.Property(prescription => prescription.IntervalGroup)
            .HasConversion(ValueObjectConverters.IntervalGroup)
            .HasMaxLength(IntervalGroup.MaxLength);
        builder.Property(prescription => prescription.StartDate).IsRequired();
        builder.Property(prescription => prescription.Prescriber).HasMaxLength(PrescriptionTerms.PrescriberMaxLength);
        builder.Property(prescription => prescription.Instructions).HasMaxLength(PrescriptionTerms.InstructionsMaxLength);
        builder.Property(prescription => prescription.CreatedAt).IsRequired();
        builder.Property(prescription => prescription.UpdatedAt).IsRequired();
        builder.Property(prescription => prescription.ClientUpdatedAt).IsRequired();
        builder.Ignore(prescription => prescription.Terms);
        builder.Ignore(prescription => prescription.IsDeleted);
        builder.Ignore(prescription => prescription.IsActive);
        builder.HasIndex(prescription => new { prescription.BabyId, prescription.UpdatedAt });
        builder.HasIndex(prescription => new { prescription.BabyId, prescription.MedicationId });
        builder.HasOne<Baby>().WithMany().HasForeignKey(prescription => prescription.BabyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(prescription => prescription.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }

    private static void ConfigureDose(OwnedNavigationBuilder<Prescription, DoseRule> dose)
    {
        dose.Property(value => value.Amount).HasPrecision(10, 3).HasColumnName("dose_amount").IsRequired();
        dose.Property(value => value.Unit).HasMaxLength(Dosage.UnitMaxLength).HasColumnName("dose_unit").IsRequired();
        dose.Property(value => value.PerKg).HasColumnName("dose_per_kg").IsRequired();
        dose.Property(value => value.RoundingStep).HasPrecision(10, 3).HasColumnName("dose_rounding_step");
    }

    private static void ConfigureSchedule(OwnedNavigationBuilder<Prescription, PrescriptionSchedule> schedule)
    {
        schedule.Property(value => value.Kind).HasConversion<string>().HasMaxLength(EnumMaxLength).HasColumnName("kind").IsRequired();
        schedule.Property(value => value.TimesOfDay)
            .HasConversion(ValueObjectConverters.TimesOfDay)
            .HasMaxLength(TimesOfDayMaxLength)
            .HasColumnName("times_of_day");
        schedule.Property(value => value.EveryMinutes).HasColumnName("every_minutes");
        schedule.Property(value => value.MinIntervalMinutes).HasColumnName("min_interval_minutes");
        schedule.Property(value => value.MaxDosesPer24h).HasColumnName("max_doses_per_24h");
        schedule.Property(value => value.Indication).HasMaxLength(PrescriptionSchedule.IndicationMaxLength).HasColumnName("indication");
        schedule.Ignore(value => value.OwnInterval);
    }
}
