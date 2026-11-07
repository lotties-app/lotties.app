using Lotties.Domain.Vaccinations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// Recorded vaccines are soft deleted (<c>deleted_at</c>) and the delta returns deleted ones, so there is no query
/// filter. The network is stored as its lower-case wire code. <c>(baby_id, given_on)</c> serves the history and the
/// status engine, <c>(baby_id, updated_at)</c> the delta. The schedule's keys and dose ids are kept as text (a schedule
/// update never breaks an older record).
/// </remarks>
internal sealed class VaccinationConfiguration : IEntityTypeConfiguration<Vaccination>
{
    public const int CodeMaxLength = 16;

    private static readonly ValueConverter<VaccineNetwork, string> NetworkCode =
        new(network => network.ToString().ToLowerInvariant(), code => Enum.Parse<VaccineNetwork>(code, true));

    public void Configure(EntityTypeBuilder<Vaccination> builder)
    {
        builder.ToTable("vaccinations");
        builder.HasKey(vaccination => vaccination.Id);
        builder.Property(vaccination => vaccination.Id).ValueGeneratedNever();
        builder.Property(vaccination => vaccination.VaccineKey).HasMaxLength(VaccinationTerms.VaccineKeyMaxLength);
        builder.Property(vaccination => vaccination.DoseId).HasMaxLength(VaccinationTerms.DoseIdMaxLength);
        builder.Property(vaccination => vaccination.CustomName).HasMaxLength(VaccinationTerms.CustomNameMaxLength);
        builder.Property(vaccination => vaccination.DoseLabel).HasMaxLength(VaccinationTerms.DoseLabelMaxLength);
        builder.Property(vaccination => vaccination.GivenOn).IsRequired();
        builder.Property(vaccination => vaccination.Network).HasConversion(NetworkCode).HasMaxLength(CodeMaxLength).IsRequired();
        builder.Property(vaccination => vaccination.Clinic).HasMaxLength(VaccinationTerms.ClinicMaxLength);
        builder.Property(vaccination => vaccination.Lot).HasMaxLength(VaccinationTerms.LotMaxLength);
        builder.Property(vaccination => vaccination.AdministeredBy).HasMaxLength(VaccinationTerms.AdministeredByMaxLength);
        builder.Property(vaccination => vaccination.Notes).HasMaxLength(VaccinationTerms.NotesMaxLength);
        builder.Property(vaccination => vaccination.CreatedAt).IsRequired();
        builder.Property(vaccination => vaccination.UpdatedAt).IsRequired();
        builder.Property(vaccination => vaccination.ClientUpdatedAt).IsRequired();
        builder.Ignore(vaccination => vaccination.Terms);
        builder.Ignore(vaccination => vaccination.IsDeleted);
        builder.HasIndex(vaccination => new { vaccination.BabyId, vaccination.GivenOn });
        builder.HasIndex(vaccination => new { vaccination.BabyId, vaccination.UpdatedAt });
        builder.HasIndex(vaccination => vaccination.CreatedBy);
    }
}
