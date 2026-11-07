using System.Text.Json;
using System.Text.Json.Serialization;
using Lotties.Domain.Medications;
using Lotties.Domain.Notes;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;
using Lotties.Infrastructure.Persistence.Converters;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <summary>Converters of doctor access step 2 (docs/design/16-doctor-access.md section 10).</summary>
internal static class DoctorProposalConverters
{
    private static readonly JsonSerializerOptions SnapshotJson = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static readonly ValueConverter<ProposalStatus, string> Status =
        new(status => ProposalCodes.Of(status), code => ProposalCodes.StatusOf(code));

    public static readonly ValueConverter<ProposalCancelReason, string> CancelReason =
        new(reason => ProposalCodes.Of(reason), code => ProposalCodes.CancelReasonOf(code));

    /// <summary>The doctor's original proposal as camelCase JSON (jsonb); read back as stored, never validated again.</summary>
    public static readonly ValueConverter<PrescriptionSnapshot?, string> Snapshot =
        new(snapshot => JsonSerializer.Serialize(snapshot, SnapshotJson), json => JsonSerializer.Deserialize<PrescriptionSnapshot>(json, SnapshotJson));

    /// <summary>Snapshots are immutable once stored: compare by their JSON.</summary>
    public static readonly ValueComparer<PrescriptionSnapshot?> SnapshotComparer =
        new(
            (left, right) => JsonSerializer.Serialize(left, SnapshotJson) == JsonSerializer.Serialize(right, SnapshotJson),
            snapshot => JsonSerializer.Serialize(snapshot, SnapshotJson).GetHashCode(StringComparison.Ordinal),
            snapshot => snapshot);
}

/// <remarks>
/// The prescription payload is flattened into columns exactly like <c>prescriptions</c> (the same owned dose and schedule
/// types and column names). No foreign key on <c>medication_id</c>, <c>product_id</c>,
/// <c>replaces_prescription_id</c> or <c>accepted_prescription_id</c>: they are references the doctor saw, checked when
/// written, and a medication or product may go away later (the accept resolves the medication again). <c>(baby_id,
/// updated_at)</c> serves the delta, <c>(baby_id, author_user_id)</c> the doctor's list and the cancel on removal,
/// <c>(baby_id, status, created_at)</c> the push scheduler. The <c>xmin</c> row version makes two concurrent decisions
/// conflict (the second is 409, retried).
/// </remarks>
internal sealed class PrescriptionProposalConfiguration : IEntityTypeConfiguration<PrescriptionProposal>
{
    public const int CodeMaxLength = 16;

    public void Configure(EntityTypeBuilder<PrescriptionProposal> builder)
    {
        builder.ToTable("prescription_proposals");
        builder.HasKey(proposal => proposal.Id);
        builder.Property(proposal => proposal.Id).ValueGeneratedNever();
        builder.Property(proposal => proposal.MedicationName).HasMaxLength(Medication.NameMaxLength).IsRequired();
        builder.OwnsOne(proposal => proposal.Dose, PrescriptionConfiguration.ConfigureDose);
        builder.Navigation(proposal => proposal.Dose).IsRequired();
        builder.OwnsOne(proposal => proposal.Schedule, PrescriptionConfiguration.ConfigureSchedule);
        builder.Navigation(proposal => proposal.Schedule).IsRequired();
        builder.Property(proposal => proposal.IntervalGroup)
            .HasConversion(ValueObjectConverters.IntervalGroup)
            .HasMaxLength(IntervalGroup.MaxLength);
        builder.Property(proposal => proposal.StartDate).IsRequired();
        builder.Property(proposal => proposal.Instructions).HasMaxLength(PrescriptionTerms.InstructionsMaxLength);
        builder.Property(proposal => proposal.Status).HasConversion(DoctorProposalConverters.Status).HasMaxLength(CodeMaxLength).IsRequired();
        builder.Property(proposal => proposal.DeclineReason).HasMaxLength(PrescriptionProposal.DeclineReasonMaxLength);
        builder.Property(proposal => proposal.CancelReason).HasConversion(DoctorProposalConverters.CancelReason).HasMaxLength(CodeMaxLength);
        builder.Property(proposal => proposal.CreatedAt).IsRequired();
        builder.Property(proposal => proposal.UpdatedAt).IsRequired();
        builder.Property(proposal => proposal.ClientUpdatedAt).IsRequired();
        builder.Ignore(proposal => proposal.Terms);
        builder.Ignore(proposal => proposal.IsPending);
        builder.Ignore(proposal => proposal.StatusCode);
        builder.HasXminRowVersion();
        builder.HasIndex(proposal => new { proposal.BabyId, proposal.UpdatedAt });
        builder.HasIndex(proposal => new { proposal.BabyId, proposal.AuthorUserId });
        builder.HasIndex(proposal => new { proposal.BabyId, proposal.Status, proposal.CreatedAt });
        builder.HasIndex(proposal => proposal.AuthorUserId);
        builder.HasIndex(proposal => proposal.DecidedBy);
    }
}

/// <remarks>
/// One row per member and note (the key). The note's foreign key cascades (a note is only soft deleted, so in practice
/// never); the user's is RESTRICT like the other per-user rows. <c>(baby_id, user_id, read_at)</c> serves the delta of a
/// member's reads.
/// </remarks>
internal sealed class NoteReadConfiguration : IEntityTypeConfiguration<NoteRead>
{
    public void Configure(EntityTypeBuilder<NoteRead> builder)
    {
        builder.ToTable("note_reads");
        builder.HasKey(read => new { read.NoteId, read.UserId });
        builder.Property(read => read.ReadAt).IsRequired();
        builder.HasIndex(read => new { read.BabyId, read.UserId, read.ReadAt });
        builder.HasOne<BabyNote>().WithMany().HasForeignKey(read => read.NoteId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(read => read.UserId);
    }
}
