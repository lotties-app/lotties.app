using Lotties.Domain.Notes;
using Lotties.Domain.Notifications;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model and migration checks of doctor access step 2 (docs/design/16-doctor-access.md section 10).</summary>
public sealed class DoctorProposalsModelTests
{
    private static string Section(string script) =>
        script[script.IndexOf("_DoctorProposals'", StringComparison.Ordinal)..];

    [Fact]
    public void Proposals_ShareThePrescriptionColumnsAndHaveTheirIndexesAndRowVersion()
    {
        using var context = ModelTestContext.Create();
        var proposal = context.Entity<PrescriptionProposal>();

        var indexes = proposal.GetIndexes().Select(index => string.Join(",", index.Properties.Select(property => property.Name))).ToArray();

        Assert.Equal("prescription_proposals", proposal.GetTableName());
        Assert.Contains("BabyId,UpdatedAt", indexes);
        Assert.Contains("BabyId,AuthorUserId", indexes);
        Assert.Contains("BabyId,Status,CreatedAt", indexes);
        Assert.True(proposal.FindProperty("Version")!.IsConcurrencyToken);
        Assert.Equal((2000, 500), (proposal.FindProperty("Instructions")!.GetMaxLength(), proposal.FindProperty("DeclineReason")!.GetMaxLength()));
        Assert.Equal(typeof(string), proposal.FindProperty("Status")!.GetValueConverter()!.ProviderClrType);
    }

    [Fact]
    public void NoteReads_AreKeyedByNoteAndMember()
    {
        using var context = ModelTestContext.Create();
        var read = context.Entity<NoteRead>();

        Assert.Equal("note_reads", read.GetTableName());
        Assert.Equal(["NoteId", "UserId"], read.FindPrimaryKey()!.Properties.Select(property => property.Name));
        Assert.Contains(read.GetIndexes(), index => index.Properties.Select(property => property.Name).SequenceEqual(["BabyId", "UserId", "ReadAt"]));
    }

    [Fact]
    public void Prescriptions_ProvenanceIsNullableOrDefaulted()
    {
        using var context = ModelTestContext.Create();
        var prescription = context.Entity<Prescription>();

        Assert.All(
            new[] { "PrescribedByUserId", "PrescribedByName", "ProposalId", "OriginalSnapshot" },
            name => Assert.True(prescription.FindProperty(name)!.IsNullable, name));
        Assert.Equal("jsonb", prescription.FindProperty("OriginalSnapshot")!.GetColumnType());
        Assert.Equal(false, prescription.FindProperty("ChangedByParent")!.GetDefaultValue());
        Assert.Equal(PrescriptionTerms.InstructionsMaxLength, prescription.FindProperty("Instructions")!.GetMaxLength());
    }

    [Fact]
    public void IdempotentScript_DoctorProposalsAddsTablesAndDefaultedColumnsWithoutTouchingRows()
    {
        using var context = ModelTestContext.Create();

        var section = Section(context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent));

        Assert.Contains("CREATE TABLE prescription_proposals (", section, StringComparison.Ordinal);
        Assert.Contains("CREATE TABLE note_reads (", section, StringComparison.Ordinal);
        Assert.Contains("dose_amount numeric(10,3) NOT NULL", section, StringComparison.Ordinal);
        Assert.Contains("day_parts character varying(40)", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE prescriptions ADD changed_by_parent boolean NOT NULL DEFAULT FALSE;", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE prescriptions ADD original_snapshot jsonb;", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE baby_notification_preferences ADD doctor_suggestions boolean NOT NULL DEFAULT FALSE;", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE prescriptions ALTER COLUMN instructions TYPE character varying(2000);", section, StringComparison.Ordinal);
        Assert.Contains("OR appointment_reminders OR doctor_suggestions", section, StringComparison.Ordinal);
        Assert.DoesNotContain("xmin xid", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE ", section, StringComparison.Ordinal);
        Assert.DoesNotContain("DELETE FROM", section, StringComparison.Ordinal);
    }

    [Fact]
    public void Preferences_DoctorSuggestionsIsInTheCandidateFilter()
    {
        using var context = ModelTestContext.Create();
        var preferences = context.Entity<BabyNotificationPreferences>();

        var candidates = preferences.GetIndexes().Single(index => index.GetFilter() is not null);

        Assert.Contains("OR doctor_suggestions", candidates.GetFilter(), StringComparison.Ordinal);
        Assert.Equal(false, preferences.FindProperty("DoctorSuggestions")!.GetDefaultValue());
    }
}
