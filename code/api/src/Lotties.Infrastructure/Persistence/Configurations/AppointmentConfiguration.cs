using Lotties.Domain.Appointments;
using Lotties.Domain.Babies;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// Appointments are never deleted (cancelling is the soft delete), so there is no query filter. Type and status are
/// stored as their lower-case wire codes; the reminder offsets as comma-separated minutes (<c>1440,120</c>, empty for
/// none). <c>(baby_id, starts_at)</c> serves the calendar range, <c>(baby_id, updated_at)</c> the delta, and the partial
/// index <see cref="UpcomingIndex"/> (<c>(baby_id, starts_at) WHERE status = 'upcoming'</c>) the push scheduler's
/// look-ahead over upcoming appointments.
/// </remarks>
internal sealed class AppointmentConfiguration : IEntityTypeConfiguration<Appointment>
{
    public const int CodeMaxLength = 16;
    public const string UpcomingFilter = "status = 'upcoming'";
    public const string UpcomingIndex = "ix_appointments_upcoming";

    private static readonly ValueConverter<AppointmentType, string> TypeCode =
        new(type => type.ToString().ToLowerInvariant(), code => Enum.Parse<AppointmentType>(code, true));

    private static readonly ValueConverter<AppointmentStatus, string> StatusCode =
        new(status => status.ToString().ToLowerInvariant(), code => Enum.Parse<AppointmentStatus>(code, true));

    private static readonly ValueConverter<AppointmentReminders, string> RemindersText =
        new(reminders => reminders.ToStorage(), text => AppointmentReminders.FromStorage(text));

    public void Configure(EntityTypeBuilder<Appointment> builder)
    {
        builder.ToTable("appointments");
        builder.HasKey(appointment => appointment.Id);
        builder.Property(appointment => appointment.Id).ValueGeneratedNever();
        builder.Property(appointment => appointment.Title).HasMaxLength(AppointmentTerms.TitleMaxLength).IsRequired();
        builder.Property(appointment => appointment.Type).HasConversion(TypeCode).HasMaxLength(CodeMaxLength).IsRequired();
        builder.Property(appointment => appointment.StartsAt).IsRequired();
        builder.Property(appointment => appointment.Location).HasMaxLength(AppointmentTerms.LocationMaxLength);
        builder.Property(appointment => appointment.DoctorName).HasMaxLength(AppointmentTerms.DoctorNameMaxLength);
        builder.Property(appointment => appointment.Notes).HasMaxLength(AppointmentTerms.NotesMaxLength);
        builder.Property(appointment => appointment.Outcome).HasMaxLength(AppointmentTerms.OutcomeMaxLength);
        builder.Property(appointment => appointment.Status).HasConversion(StatusCode).HasMaxLength(CodeMaxLength).IsRequired();
        builder.Property(appointment => appointment.Reminders)
            .HasConversion(RemindersText)
            .HasMaxLength(AppointmentReminders.StorageMaxLength)
            .HasColumnName("reminder_offsets_minutes")
            .IsRequired();
        builder.Property(appointment => appointment.ProviderId);
        builder.Property(appointment => appointment.CreatedAt).IsRequired();
        builder.Property(appointment => appointment.UpdatedAt).IsRequired();
        builder.Property(appointment => appointment.ClientUpdatedAt).IsRequired();
        builder.Ignore(appointment => appointment.Terms);
        builder.HasIndex(appointment => new { appointment.BabyId, appointment.StartsAt });
        builder.HasIndex(appointment => new { appointment.BabyId, appointment.UpdatedAt });
        builder.HasIndex(appointment => new { appointment.BabyId, appointment.StartsAt }, UpcomingIndex)
            .HasFilter(UpcomingFilter)
            .HasDatabaseName(UpcomingIndex);
        builder.HasOne<Baby>().WithMany().HasForeignKey(appointment => appointment.BabyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(appointment => appointment.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
