using Lotties.Domain.CareProviders;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// Providers are never removed (<c>is_deleted</c> is the soft delete and clients must learn it through the delta), so
/// there is no query filter. <c>(baby_id, updated_at)</c> serves the delta pull. Appointments link a provider by id
/// without a foreign key, so an offline client may push an appointment before its provider.
/// </remarks>
internal sealed class CareProviderConfiguration : IEntityTypeConfiguration<CareProvider>
{
    public void Configure(EntityTypeBuilder<CareProvider> builder)
    {
        builder.ToTable("care_providers");
        builder.HasKey(provider => provider.Id);
        builder.Property(provider => provider.Id).ValueGeneratedNever();
        builder.Property(provider => provider.Name).HasMaxLength(CareProviderTerms.NameMaxLength).IsRequired();
        builder.Property(provider => provider.Specialty).HasMaxLength(CareProviderTerms.SpecialtyMaxLength);
        builder.Property(provider => provider.RegistrationCouncil).HasMaxLength(CareProviderTerms.RegistrationCouncilMaxLength);
        builder.Property(provider => provider.RegistrationNumber).HasMaxLength(CareProviderTerms.RegistrationNumberMaxLength);
        builder.Property(provider => provider.RegistrationRegion).HasMaxLength(CareProviderTerms.RegistrationRegionMaxLength);
        builder.Property(provider => provider.ClinicName).HasMaxLength(CareProviderTerms.ClinicNameMaxLength);
        builder.Property(provider => provider.Address).HasMaxLength(CareProviderTerms.AddressMaxLength);
        builder.Property(provider => provider.Phone).HasMaxLength(CareProviderTerms.PhoneMaxLength);
        builder.Property(provider => provider.Whatsapp).HasMaxLength(CareProviderTerms.WhatsappMaxLength);
        builder.Property(provider => provider.Email).HasMaxLength(CareProviderTerms.EmailMaxLength);
        builder.Property(provider => provider.Website).HasMaxLength(CareProviderTerms.WebsiteMaxLength);
        builder.Property(provider => provider.Notes).HasMaxLength(CareProviderTerms.NotesMaxLength);
        builder.Property(provider => provider.IsFavorite).IsRequired();
        builder.Property(provider => provider.IsDeleted).IsRequired();
        builder.Property(provider => provider.CreatedAt).IsRequired();
        builder.Property(provider => provider.UpdatedAt).IsRequired();
        builder.Property(provider => provider.ClientUpdatedAt).IsRequired();
        builder.Ignore(provider => provider.Terms);
        builder.HasIndex(provider => new { provider.BabyId, provider.UpdatedAt });
        builder.HasIndex(provider => provider.CreatedBy);
    }
}
