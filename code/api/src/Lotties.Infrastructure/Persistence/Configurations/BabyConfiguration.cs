using Lotties.Domain.Babies;
using Lotties.Domain.Vaccinations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// The baby and its members are one aggregate guarded by the baby row's <c>xmin</c> row version
/// (<see cref="RowVersions"/>); the baby repository rewrites the baby row whenever its members change, so concurrent
/// member changes (e.g. two owners demoting each other) conflict instead of both passing the last-owner rule.
/// The vaccine profile is three columns: <c>vaccine_profile</c> (<c>public</c> or <c>public+private</c>, NOT NULL DEFAULT
/// 'public', so existing babies show the public schedule), <c>gestational_age_weeks</c> (smallint) and
/// <c>rsv_maternal_vaccination</c> (<c>unknown</c>, <c>yes</c> or <c>no</c>), both nullable.
/// </remarks>
internal sealed class BabyConfiguration : IEntityTypeConfiguration<Baby>
{
    public const int CodeMaxLength = 16;

    private static readonly ValueConverter<VaccineCoverage, string> CoverageCode =
        new(coverage => VaccineProfile.CodeOf(coverage), code => VaccineProfile.CoverageOf(code));

    private static readonly ValueConverter<RsvMaternalVaccination, string> RsvCode =
        new(answer => answer.ToString().ToLowerInvariant(), code => Enum.Parse<RsvMaternalVaccination>(code, true));

    public void Configure(EntityTypeBuilder<Baby> builder)
    {
        builder.ToTable("babies");
        builder.HasXminRowVersion();
        builder.HasKey(baby => baby.Id);

        // Named explicitly: the routing columns share this row and key (BabyStoreAssignmentConfiguration, table splitting).
        builder.Property(baby => baby.Id).HasColumnName(BabyStoreAssignmentConfiguration.KeyColumn).ValueGeneratedNever();
        builder.Property(baby => baby.Name).HasMaxLength(Baby.NameMaxLength).IsRequired();
        builder.Property(baby => baby.Label).HasMaxLength(BabyLabels.MaxLength);
        builder.Property(baby => baby.BirthDate).IsRequired();
        builder.Property(baby => baby.BirthDateWeekOnly).IsRequired().HasDefaultValue(false);
        builder.Ignore(baby => baby.ShownName);
        builder.Ignore(baby => baby.ResolvedLabel);
        builder.Property(baby => baby.CreatedAt).IsRequired();
        builder.Property(baby => baby.VaccineCoverage)
            .HasConversion(CoverageCode)
            .HasColumnName("vaccine_profile")
            .HasMaxLength(CodeMaxLength)
            .HasDefaultValue(VaccineCoverage.Public)
            .HasSentinel(VaccineCoverage.Public)
            .IsRequired();
        builder.Property(baby => baby.GestationalAgeWeeks);
        builder.Property(baby => baby.RsvMaternalVaccination).HasConversion(RsvCode).HasMaxLength(CodeMaxLength);
        builder.Ignore(baby => baby.VaccineProfile);
        builder.HasMany(baby => baby.Members)
            .WithOne()
            .HasForeignKey(member => member.BabyId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(baby => baby.Members).UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
