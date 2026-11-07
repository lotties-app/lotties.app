using Lotties.Domain.AccessLogs;
using Lotties.Domain.Babies;
using Lotties.Domain.Notes;
using Lotties.Domain.Professionals;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <summary>Lower-case wire codes for the doctor access enums (stored as text, no check constraint, like the roles).</summary>
internal static class DoctorAccessCodes
{
    public const int CodeMaxLength = 16;

    public static ValueConverter<TEnum, string> LowerCase<TEnum>()
        where TEnum : struct, Enum =>
        new(value => value.ToString().ToLowerInvariant(), code => Enum.Parse<TEnum>(code, true));
}

/// <remarks>One profile per user: the user id is the key. <c>verified</c> is stored for a future review flow; v1 never sets it.</remarks>
internal sealed class ProfessionalProfileConfiguration : IEntityTypeConfiguration<ProfessionalProfile>
{
    public void Configure(EntityTypeBuilder<ProfessionalProfile> builder)
    {
        builder.ToTable("professional_profiles");
        builder.HasKey(profile => profile.UserId);
        builder.Property(profile => profile.UserId).ValueGeneratedNever();
        builder.Property(profile => profile.Kind)
            .HasConversion(DoctorAccessCodes.LowerCase<ProfessionalKind>())
            .HasMaxLength(DoctorAccessCodes.CodeMaxLength)
            .IsRequired();
        builder.Property(profile => profile.DisplayName).HasMaxLength(ProfessionalProfileTerms.DisplayNameMaxLength).IsRequired();
        builder.Property(profile => profile.Specialty).HasMaxLength(ProfessionalProfileTerms.SpecialtyMaxLength);
        builder.Property(profile => profile.RegistrationNumber).HasMaxLength(ProfessionalProfileTerms.RegistrationNumberMaxLength);
        builder.Property(profile => profile.ShareDisplayName).IsRequired().HasDefaultValue(false);
        builder.Property(profile => profile.ShareRegistration).IsRequired().HasDefaultValue(false);
        builder.Property(profile => profile.Verified).IsRequired();
        builder.Property(profile => profile.CreatedAt).IsRequired();
        builder.Property(profile => profile.UpdatedAt).IsRequired();
        builder.Ignore(profile => profile.Terms);
        builder.HasOne<User>().WithOne().HasForeignKey<ProfessionalProfile>(profile => profile.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <remarks>
/// Notes are soft deleted (<c>deleted_at</c>) and there is no query filter: the delta must carry deletions. Every read
/// filters by visibility in the repository. <c>(baby_id, updated_at)</c> serves the delta.
/// </remarks>
internal sealed class BabyNoteConfiguration : IEntityTypeConfiguration<BabyNote>
{
    public void Configure(EntityTypeBuilder<BabyNote> builder)
    {
        builder.ToTable("baby_notes");
        builder.HasKey(note => note.Id);
        builder.Property(note => note.Id).ValueGeneratedNever();
        builder.Property(note => note.Kind)
            .HasConversion(DoctorAccessCodes.LowerCase<NoteKind>())
            .HasMaxLength(DoctorAccessCodes.CodeMaxLength)
            .IsRequired();
        builder.Property(note => note.Visibility)
            .HasConversion(DoctorAccessCodes.LowerCase<NoteVisibility>())
            .HasMaxLength(DoctorAccessCodes.CodeMaxLength)
            .IsRequired();
        builder.Property(note => note.Body).HasMaxLength(NoteTerms.BodyMaxLength).IsRequired();
        builder.Property(note => note.CreatedAt).IsRequired();
        builder.Property(note => note.UpdatedAt).IsRequired();
        builder.Property(note => note.ClientUpdatedAt).IsRequired();
        builder.Ignore(note => note.Terms);
        builder.Ignore(note => note.IsDeleted);
        builder.HasIndex(note => new { note.BabyId, note.UpdatedAt });
        builder.HasIndex(note => note.AuthorUserId);
        builder.HasOne<Baby>().WithMany().HasForeignKey(note => note.BabyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(note => note.AuthorUserId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <remarks>
/// Append only. The role is stored by name like <c>baby_members.role</c>. <c>(baby_id, at)</c> serves the Owner's list,
/// <c>(baby_id, user_id, at)</c> the hourly throttle.
/// </remarks>
internal sealed class AccessLogEntryConfiguration : IEntityTypeConfiguration<AccessLogEntry>
{
    public void Configure(EntityTypeBuilder<AccessLogEntry> builder)
    {
        builder.ToTable("access_log");
        builder.HasKey(entry => entry.Id);
        builder.Property(entry => entry.Id).ValueGeneratedNever();
        builder.Property(entry => entry.Role).HasConversion<string>().HasMaxLength(BabyMemberConfiguration.RoleMaxLength).IsRequired();
        builder.Property(entry => entry.Kind)
            .HasConversion(DoctorAccessCodes.LowerCase<AccessKind>())
            .HasMaxLength(DoctorAccessCodes.CodeMaxLength)
            .IsRequired();
        builder.Property(entry => entry.At).IsRequired();
        builder.HasIndex(entry => new { entry.BabyId, entry.At });
        builder.HasIndex(entry => new { entry.BabyId, entry.UserId, entry.At });
        builder.HasOne<Baby>().WithMany().HasForeignKey(entry => entry.BabyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(entry => entry.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}
