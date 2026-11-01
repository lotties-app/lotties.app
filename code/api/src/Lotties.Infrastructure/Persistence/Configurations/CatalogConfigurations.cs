using Lotties.Domain.Catalog;
using Lotties.Domain.Medications;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence.Converters;
using Lotties.Infrastructure.Persistence.Seed;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

internal sealed class SubstanceConfiguration : IEntityTypeConfiguration<Substance>
{
    public const int SynonymsMaxLength = 520;

    public void Configure(EntityTypeBuilder<Substance> builder)
    {
        builder.ToTable("substances");
        builder.HasKey(substance => substance.Id);
        builder.Property(substance => substance.Id).ValueGeneratedNever();
        builder.Property(substance => substance.Key).HasMaxLength(Substance.KeyMaxLength).IsRequired();
        builder.Property(substance => substance.NameEn).HasMaxLength(Substance.NameMaxLength).IsRequired();
        builder.Property(substance => substance.NamePtBr).HasMaxLength(Substance.NameMaxLength).IsRequired();
        builder.Property(substance => substance.Synonyms)
            .HasConversion(ValueObjectConverters.Synonyms, ValueObjectConverters.SynonymsComparer)
            .HasMaxLength(SynonymsMaxLength)
            .IsRequired();
        builder.Property(substance => substance.CreatedAt).IsRequired();
        builder.Ignore(substance => substance.SearchNames);
        builder.HasIndex(substance => substance.Key).IsUnique();
        builder.HasData(MedicationCatalogSeed.Substances);
    }
}

/// <remarks>
/// Non-merged products are unique by (normalized name, form, country): a partial unique index (<c>merged_into_id IS NULL</c>),
/// which PostgreSQL and SQLite both support. Search loads candidates by normalized-name prefix and length buckets, so no
/// trigram extension is needed.
/// </remarks>
internal sealed class ProductConfiguration : IEntityTypeConfiguration<Product>
{
    public const int FormMaxLength = 16;
    public const int StatusMaxLength = 16;
    public const string NotMergedFilter = "merged_into_id IS NULL";

    public void Configure(EntityTypeBuilder<Product> builder)
    {
        builder.ToTable("products");
        builder.HasKey(product => product.Id);
        builder.Property(product => product.Id).ValueGeneratedNever();
        builder.Property(product => product.Name).HasMaxLength(Product.NameMaxLength).IsRequired();
        builder.Property(product => product.NormalizedName).HasMaxLength(Product.NameMaxLength).IsRequired();
        builder.Property(product => product.Form).HasConversion<string>().HasMaxLength(FormMaxLength).IsRequired();
        builder.Property(product => product.Country)
            .HasConversion(ValueObjectConverters.CountryCode)
            .HasMaxLength(CountryCode.Length)
            .IsFixedLength()
            .IsRequired();
        builder.Property(product => product.Status).HasConversion<string>().HasMaxLength(StatusMaxLength).IsRequired();
        builder.Property(product => product.CreatedAt).IsRequired();
        builder.Ignore(product => product.SubstanceIds);
        builder.Ignore(product => product.IsMerged);
        builder.HasMany(product => product.Substances).WithOne().HasForeignKey(substance => substance.ProductId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(product => product.Substances).HasField("_substances").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasIndex(product => new { product.NormalizedName, product.Form, product.Country }).IsUnique().HasFilter(NotMergedFilter);
        builder.HasIndex(product => product.MergedIntoId);
        builder.HasOne<Product>().WithMany().HasForeignKey(product => product.MergedIntoId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(product => product.CreatedBy).OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class ProductSubstanceConfiguration : IEntityTypeConfiguration<ProductSubstance>
{
    public void Configure(EntityTypeBuilder<ProductSubstance> builder)
    {
        builder.ToTable("product_substances");
        builder.HasKey(link => new { link.ProductId, link.SubstanceId });
        builder.OwnsOne(link => link.Strength, strength =>
        {
            strength.Property(value => value.Amount).HasPrecision(10, 3).HasColumnName("strength_amount");
            strength.Property(value => value.Unit).HasMaxLength(Dosage.UnitMaxLength).HasColumnName("strength_unit");
            strength.Property(value => value.PerAmount).HasPrecision(10, 3).HasColumnName("strength_per_amount");
            strength.Property(value => value.PerUnit).HasMaxLength(Dosage.UnitMaxLength).HasColumnName("strength_per_unit");
        });
        builder.HasIndex(link => link.SubstanceId);
        builder.HasOne<Substance>().WithMany().HasForeignKey(link => link.SubstanceId).OnDelete(DeleteBehavior.Restrict);
    }
}
