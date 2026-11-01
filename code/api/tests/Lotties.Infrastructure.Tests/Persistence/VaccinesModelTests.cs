using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Lotties.Domain.Vaccinations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model and migration checks of the recorded vaccines, the baby's vaccine profile and the vaccine reminder preference.</summary>
public sealed class VaccinesModelTests
{
    [Fact]
    public void Vaccinations_HaveTheHistoryAndDeltaIndexesAndBoundedColumns()
    {
        using var context = ModelTestContext.Create();
        var vaccination = context.Entity<Vaccination>();

        var indexes = vaccination.GetIndexes().Select(index => (Columns: string.Join(',', index.Properties.Select(property => property.GetColumnName())), Name: index.GetDatabaseName())).ToArray();
        var babyKey = vaccination.GetForeignKeys().Single(key => key.Properties[0].Name == nameof(Vaccination.BabyId));

        Assert.Equal("vaccinations", vaccination.GetTableName());
        Assert.Contains(("baby_id,given_on", "ix_vaccinations_baby_id_given_on"), indexes);
        Assert.Contains(("baby_id,updated_at", "ix_vaccinations_baby_id_updated_at"), indexes);
        Assert.Equal(DeleteBehavior.Restrict, babyKey.DeleteBehavior);
        Assert.Equal(
            (40, 60, 80, 80, 120, 40, 80, 1000),
            (Max(vaccination, "VaccineKey"), Max(vaccination, "DoseId"), Max(vaccination, "CustomName"), Max(vaccination, "DoseLabel"), Max(vaccination, "Clinic"), Max(vaccination, "Lot"), Max(vaccination, "AdministeredBy"), Max(vaccination, "Notes")));
        Assert.True(vaccination.FindProperty(nameof(Vaccination.DeletedAt))!.IsNullable);
    }

    [Theory]
    [InlineData(VaccineNetwork.Public, "public")]
    [InlineData(VaccineNetwork.Private, "private")]
    public void Vaccinations_NetworkIsStoredAsItsWireCode(VaccineNetwork network, string code)
    {
        using var context = ModelTestContext.Create();

        var converter = context.Entity<Vaccination>().FindProperty(nameof(Vaccination.Network))!.GetValueConverter()!;

        Assert.Equal(code, converter.ConvertToProvider(network));
        Assert.Equal(network, converter.ConvertFromProvider(code));
    }

    [Fact]
    public void Babies_VaccineProfileColumnsDefaultToThePublicSchedule()
    {
        using var context = ModelTestContext.Create();
        var baby = context.Entity<Baby>();

        var profile = baby.FindProperty(nameof(Baby.VaccineCoverage))!;
        var weeks = baby.FindProperty(nameof(Baby.GestationalAgeWeeks))!;
        var rsv = baby.FindProperty(nameof(Baby.RsvMaternalVaccination))!;

        Assert.Equal(("vaccine_profile", false, "public+private"), (profile.GetColumnName(), profile.IsNullable, profile.GetValueConverter()!.ConvertToProvider(VaccineCoverage.PublicAndPrivate)));
        Assert.Equal(VaccineCoverage.Public, profile.GetDefaultValue());
        Assert.Equal(("gestational_age_weeks", true, typeof(short?)), (weeks.GetColumnName(), weeks.IsNullable, weeks.ClrType));
        Assert.Equal(("rsv_maternal_vaccination", true, "yes"), (rsv.GetColumnName(), rsv.IsNullable, rsv.GetValueConverter()!.ConvertToProvider(RsvMaternalVaccination.Yes)));
    }

    [Fact]
    public void Preferences_VaccineRemindersDefaultToFalse()
    {
        using var context = ModelTestContext.Create();

        var column = context.Entity<BabyNotificationPreferences>().FindProperty(nameof(BabyNotificationPreferences.VaccineReminders))!;

        Assert.Equal(false, column.GetDefaultValue());
    }

    [Fact]
    public void IdempotentScript_CreatesVaccinationsAddsTheProfileColumnsAndWidensTheCandidateIndex()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var section = script[script.IndexOf("_Vaccines'", StringComparison.Ordinal)..script.IndexOf("_FeedingAmounts'", StringComparison.Ordinal)];

        Assert.Contains("CREATE TABLE vaccinations (", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE babies ADD vaccine_profile character varying(16) NOT NULL DEFAULT 'public';", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE babies ADD gestational_age_weeks smallint;", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE babies ADD rsv_maternal_vaccination character varying(16);", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE baby_notification_preferences ADD vaccine_reminders boolean NOT NULL DEFAULT FALSE;", section, StringComparison.Ordinal);
        Assert.Contains("CREATE INDEX ix_vaccinations_baby_id_given_on ON vaccinations (baby_id, given_on);", section, StringComparison.Ordinal);
        Assert.Contains("CREATE INDEX ix_vaccinations_baby_id_updated_at ON vaccinations (baby_id, updated_at);", section, StringComparison.Ordinal);
        Assert.True(
            section.IndexOf("DROP INDEX ix_baby_notification_preferences_baby_id;", StringComparison.Ordinal) < section.IndexOf("CREATE INDEX ix_baby_notification_preferences_baby_id", StringComparison.Ordinal),
            "the candidate index is dropped before it is created again");
        Assert.Contains("OR appointment_reminders OR doctor_suggestions OR vaccine_reminders;", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE ", section, StringComparison.Ordinal);
        Assert.DoesNotContain("DELETE FROM", section, StringComparison.Ordinal);
    }

    private static int? Max(Microsoft.EntityFrameworkCore.Metadata.IEntityType entity, string property) => entity.FindProperty(property)!.GetMaxLength();
}
