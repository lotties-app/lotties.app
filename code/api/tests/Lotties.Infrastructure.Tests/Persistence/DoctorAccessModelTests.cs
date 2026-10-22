using Lotties.Domain.AccessLogs;
using Lotties.Domain.Babies;
using Lotties.Domain.Measurements;
using Lotties.Domain.Notes;
using Lotties.Domain.Professionals;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model and migration checks of doctor access (docs/design/16-doctor-access.md).</summary>
public sealed class DoctorAccessModelTests
{
    [Fact]
    public void ProfessionalProfiles_AreKeyedByTheUser()
    {
        using var context = ModelTestContext.Create();
        var profile = context.Entity<ProfessionalProfile>();

        Assert.Equal(["UserId"], profile.FindPrimaryKey()!.Properties.Select(property => property.Name));
        Assert.Equal("professional_profiles", profile.GetTableName());
        Assert.Equal((100, 100, 40), (profile.FindProperty("DisplayName")!.GetMaxLength(), profile.FindProperty("Specialty")!.GetMaxLength(), profile.FindProperty("RegistrationNumber")!.GetMaxLength()));
    }

    [Fact]
    public void BabyNotes_HaveADeltaIndexAndTheBabyCannotBeDeletedUnderThem()
    {
        using var context = ModelTestContext.Create();
        var note = context.Entity<BabyNote>();

        var delta = note.GetIndexes().Single(candidate => candidate.Properties.Count == 2);
        var babyKey = note.GetForeignKeys().Single(key => key.Properties[0].Name == nameof(BabyNote.BabyId));

        Assert.Equal("baby_notes", note.GetTableName());
        Assert.Equal(["BabyId", "UpdatedAt"], delta.Properties.Select(property => property.Name));
        Assert.Equal(DeleteBehavior.Restrict, babyKey.DeleteBehavior);
        Assert.Equal(NoteTerms.BodyMaxLength, note.FindProperty("Body")!.GetMaxLength());
    }

    [Fact]
    public void AccessLog_HasTheThrottleAndListIndexes()
    {
        using var context = ModelTestContext.Create();
        var entry = context.Entity<AccessLogEntry>();

        var indexes = entry.GetIndexes().Select(index => string.Join(",", index.Properties.Select(property => property.Name))).Order().ToArray();

        Assert.Equal("access_log", entry.GetTableName());
        Assert.Contains("BabyId,At", indexes);
        Assert.Contains("BabyId,UserId,At", indexes);
    }

    [Fact]
    public void Roles_AreStoredByNameWithoutACheckConstraint_SoDoctorNeedsNoSchemaChange()
    {
        using var context = ModelTestContext.Create();
        var member = context.Entity<BabyMember>();

        Assert.Equal(typeof(string), member.FindProperty("Role")!.GetProviderClrType());
        Assert.Empty(member.GetCheckConstraints());
        Assert.True(nameof(BabyRole.Doctor).Length <= member.FindProperty("Role")!.GetMaxLength());
    }

    [Fact]
    public void IdempotentScript_DoctorAccessCreatesItsTablesAndOneMeasurementColumnOnly()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var section = script[script.IndexOf("_DoctorAccess'", StringComparison.Ordinal)..];

        Assert.Contains("CREATE TABLE professional_profiles (", section, StringComparison.Ordinal);
        Assert.Contains("CREATE TABLE baby_notes (", section, StringComparison.Ordinal);
        Assert.Contains("CREATE TABLE access_log (", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE measurements ADD recorded_by_doctor boolean NOT NULL DEFAULT FALSE;", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE ", section, StringComparison.Ordinal);
        Assert.DoesNotContain("DELETE FROM", section, StringComparison.Ordinal);
        Assert.DoesNotContain("baby_members", section, StringComparison.Ordinal);
        Assert.Equal(nameof(Measurement.RecordedByDoctor), context.Entity<Measurement>().FindProperty("RecordedByDoctor")!.Name);
    }
}
