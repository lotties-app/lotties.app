using Lotties.Domain.Appointments;
using Lotties.Domain.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model and migration checks of the per-baby appointments and the appointment reminder preference.</summary>
public sealed class AppointmentsModelTests
{
    [Fact]
    public void Appointments_HaveTheCalendarDeltaAndPartialUpcomingIndexes()
    {
        using var context = ModelTestContext.Create();
        var appointment = context.Entity<Appointment>();

        var indexes = appointment.GetIndexes().Select(index => (Columns: string.Join(',', index.Properties.Select(property => property.GetColumnName())), Filter: index.GetFilter(), Name: index.GetDatabaseName())).ToArray();

        Assert.Contains(("baby_id,starts_at", (string?)null, "ix_appointments_baby_id_starts_at"), indexes);
        Assert.Contains(("baby_id,updated_at", (string?)null, "ix_appointments_baby_id_updated_at"), indexes);
        Assert.Contains(("baby_id,starts_at", (string?)"status = 'upcoming'", "ix_appointments_upcoming"), indexes);
    }

    [Fact]
    public void Appointments_ColumnsAreBoundedAndTheBabyCannotBeDeletedUnderThem()
    {
        using var context = ModelTestContext.Create();
        var appointment = context.Entity<Appointment>();

        var babyKey = appointment.GetForeignKeys().Single(key => key.Properties[0].Name == nameof(Appointment.BabyId));

        Assert.Equal(DeleteBehavior.Restrict, babyKey.DeleteBehavior);
        Assert.Equal((80, 200, 80, 2000, 2000, 20), (appointment.FindProperty("Title")!.GetMaxLength(), appointment.FindProperty("Location")!.GetMaxLength(), appointment.FindProperty("DoctorName")!.GetMaxLength(), appointment.FindProperty("Notes")!.GetMaxLength(), appointment.FindProperty("Outcome")!.GetMaxLength(), appointment.FindProperty("Reminders")!.GetMaxLength()));
        Assert.Equal("reminder_offsets_minutes", appointment.FindProperty("Reminders")!.GetColumnName());
    }

    [Theory]
    [InlineData(AppointmentStatus.Upcoming, "upcoming")]
    [InlineData(AppointmentStatus.Done, "done")]
    [InlineData(AppointmentStatus.Cancelled, "cancelled")]
    public void Appointments_StatusIsStoredAsItsWireCode(AppointmentStatus status, string code)
    {
        using var context = ModelTestContext.Create();

        var converter = context.Entity<Appointment>().FindProperty(nameof(Appointment.Status))!.GetValueConverter()!;

        Assert.Equal(code, converter.ConvertToProvider(status));
        Assert.Equal(status, converter.ConvertFromProvider(code));
    }

    [Fact]
    public void Preferences_AppointmentRemindersDefaultToTrueInTheDatabase()
    {
        using var context = ModelTestContext.Create();

        var column = context.Entity<BabyNotificationPreferences>().FindProperty(nameof(BabyNotificationPreferences.AppointmentReminders))!;

        Assert.Equal((true, true), (column.GetDefaultValue(), column.Sentinel));
    }

    [Fact]
    public void IdempotentScript_CreatesAppointmentsAddsTheTrueDefaultedPreferenceAndWidensTheCandidateIndex()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var section = script[script.IndexOf("_Appointments'", StringComparison.Ordinal)..script.IndexOf("_FeedingAmounts'", StringComparison.Ordinal)];

        Assert.Contains("CREATE TABLE appointments (", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE baby_notification_preferences ADD appointment_reminders boolean NOT NULL DEFAULT TRUE;", section, StringComparison.Ordinal);
        Assert.Contains("CREATE INDEX ix_appointments_upcoming ON appointments (baby_id, starts_at) WHERE status = 'upcoming';", section, StringComparison.Ordinal);
        Assert.True(
            section.IndexOf("DROP INDEX ix_baby_notification_preferences_baby_id;", StringComparison.Ordinal) < section.IndexOf("CREATE INDEX ix_baby_notification_preferences_baby_id", StringComparison.Ordinal),
            "the candidate index is dropped before it is created again");
        Assert.Contains("WHERE dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup OR appointment_reminders;", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE ", section, StringComparison.Ordinal);
        Assert.DoesNotContain("DELETE FROM", section, StringComparison.Ordinal);
    }
}
