using Lotties.Domain.Appointments;
using Lotties.Domain.CareProviders;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model and migration checks of the per-baby care provider directory and the appointment provider link.</summary>
public sealed class CareProvidersModelTests
{
    [Fact]
    public void CareProviders_HaveTheDeltaIndexAndBoundedColumns()
    {
        using var context = ModelTestContext.Create();
        var provider = context.Entity<CareProvider>();

        var indexes = provider.GetIndexes().Select(index => string.Join(',', index.Properties.Select(property => property.GetColumnName()))).ToArray();
        var babyKey = provider.GetForeignKeys().Single(key => key.Properties[0].Name == nameof(CareProvider.BabyId));

        Assert.Contains("baby_id,updated_at", indexes);
        Assert.Equal(DeleteBehavior.Restrict, babyKey.DeleteBehavior);
        Assert.Equal(
            new int?[] { 80, 60, 20, 30, 10, 120, 400, 30, 30, 120, 200, 1000 },
            new[] { "Name", "Specialty", "RegistrationCouncil", "RegistrationNumber", "RegistrationRegion", "ClinicName", "Address", "Phone", "Whatsapp", "Email", "Website", "Notes" }.Select(name => provider.FindProperty(name)!.GetMaxLength()));
        Assert.Equal("care_providers", provider.GetTableName());
    }

    [Fact]
    public void Appointments_ProviderIdIsANullableLinkWithoutAForeignKey()
    {
        using var context = ModelTestContext.Create();
        var appointment = context.Entity<Appointment>();

        var property = appointment.FindProperty(nameof(Appointment.ProviderId))!;

        Assert.True(property.IsNullable);
        Assert.Equal("provider_id", property.GetColumnName());
        Assert.DoesNotContain(appointment.GetForeignKeys(), key => key.Properties.Any(p => p.Name == nameof(Appointment.ProviderId)));
    }

    [Fact]
    public void IdempotentScript_CreatesTheDirectoryAndAddsTheNullableLinkOnly()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var start = script.IndexOf("_CareProviders'", StringComparison.Ordinal);
        var section = script[start..];

        Assert.Contains("ALTER TABLE appointments ADD provider_id uuid;", section, StringComparison.Ordinal);
        Assert.Contains("CREATE TABLE care_providers (", section, StringComparison.Ordinal);
        Assert.Contains("CREATE INDEX ix_care_providers_baby_id_updated_at ON care_providers (baby_id, updated_at);", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE ", section, StringComparison.Ordinal);
        Assert.DoesNotContain("DELETE FROM", section, StringComparison.Ordinal);
    }
}
