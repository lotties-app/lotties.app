using Lotties.Domain.Babies;
using Lotties.Domain.Formulas;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// Formulas are never deleted (feeding events name them in their payload), so there is no query filter. The partial
/// unique index <see cref="OneCurrentIndex"/> holds the "one current formula per baby" rule even against concurrent
/// writes; the service clears the other current formula in an earlier save of the same transaction.
/// </remarks>
internal sealed class FormulaConfiguration : IEntityTypeConfiguration<Formula>
{
    public const string CurrentFilter = "is_current";
    public const string OneCurrentIndex = "ux_formulas_one_current_per_baby";

    public void Configure(EntityTypeBuilder<Formula> builder)
    {
        builder.ToTable("formulas");
        builder.HasKey(formula => formula.Id);
        builder.Property(formula => formula.Id).ValueGeneratedNever();
        builder.Property(formula => formula.Name).HasMaxLength(FormulaTerms.NameMaxLength).IsRequired();
        builder.Property(formula => formula.Brand).HasMaxLength(FormulaTerms.BrandMaxLength);
        builder.Property(formula => formula.Stage).HasMaxLength(FormulaTerms.StageMaxLength);
        builder.Property(formula => formula.Notes).HasMaxLength(FormulaTerms.NotesMaxLength);
        builder.Property(formula => formula.IsCurrent).IsRequired();
        builder.Property(formula => formula.IsArchived).IsRequired();
        builder.Property(formula => formula.CreatedAt).IsRequired();
        builder.Property(formula => formula.UpdatedAt).IsRequired();
        builder.Property(formula => formula.ClientUpdatedAt).IsRequired();
        builder.Ignore(formula => formula.Terms);
        builder.HasIndex(formula => new { formula.BabyId, formula.UpdatedAt });
        builder.HasIndex(formula => formula.BabyId).IsUnique().HasFilter(CurrentFilter).HasDatabaseName(OneCurrentIndex);
        builder.HasOne<Baby>().WithMany().HasForeignKey(formula => formula.BabyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(formula => formula.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
