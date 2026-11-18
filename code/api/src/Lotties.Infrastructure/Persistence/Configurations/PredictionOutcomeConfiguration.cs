using Lotties.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// Prediction outcomes track accuracy of the heuristic engine. The composite index on
/// <c>(baby_id, type_key, resolved)</c> serves both the pending-outcome query (unresolved rows for a baby+type)
/// and the resolved-history query (most recent resolved rows). Outcomes are never updated after resolution;
/// a new prediction creates a new row.
/// </remarks>
internal sealed class PredictionOutcomeConfiguration : IEntityTypeConfiguration<PredictionOutcomeEntity>
{
    public const string PendingResolvedIndex = "ix_prediction_outcomes_baby_type_resolved";

    public void Configure(EntityTypeBuilder<PredictionOutcomeEntity> builder)
    {
        builder.ToTable("prediction_outcomes");
        builder.HasKey(entity => entity.Id);
        builder.Property(entity => entity.Id).ValueGeneratedNever();
        builder.Property(entity => entity.BabyId).IsRequired();
        builder.Property(entity => entity.TypeKey).HasMaxLength(128).IsRequired();
        builder.Property(entity => entity.PredictedAt).IsRequired();
        builder.Property(entity => entity.AnchorAt).IsRequired();
        builder.Property(entity => entity.ExpectedNextStart).IsRequired();
        builder.Property(entity => entity.EngineVersion).HasMaxLength(64).IsRequired();
        builder.Property(entity => entity.AgeBand).HasMaxLength(32);
        builder.Property(entity => entity.Phase).HasMaxLength(16);
        builder.HasIndex(entity => new { entity.BabyId, entity.TypeKey, entity.Resolved })
            .HasDatabaseName(PendingResolvedIndex);
    }
}