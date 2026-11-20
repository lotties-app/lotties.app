using Lotties.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// <c>community_prediction_aggregates</c>: anonymized prediction accuracy aggregates with no baby_id or PII.
/// Written by the weekly aggregation job after applying the suppression threshold (minimum 10 resolved outcomes per cell).
/// Unique constraint on (age_band_label, type_key, phase, temporal_bucket, engine_version) ensures one aggregate per
/// dimension combination per engine version; re-runs upsert rather than duplicate.
/// </remarks>
internal sealed class CommunityPredictionAggregateConfiguration : IEntityTypeConfiguration<CommunityPredictionAggregateEntity>
{
    public void Configure(EntityTypeBuilder<CommunityPredictionAggregateEntity> builder)
    {
        builder.ToTable("community_prediction_aggregates");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();

        builder.Property(e => e.AgeBandLabel).HasMaxLength(16).IsRequired();
        builder.Property(e => e.TypeKey).HasMaxLength(64).IsRequired();
        builder.Property(e => e.Phase).HasMaxLength(16);
        builder.Property(e => e.TemporalBucket).HasMaxLength(16).IsRequired();
        builder.Property(e => e.EngineVersion).HasMaxLength(32).IsRequired();
        builder.Property(e => e.Count).IsRequired();
        builder.Property(e => e.SumErrorMinutes).IsRequired();
        builder.Property(e => e.SumSquaredError).IsRequired();
        builder.Property(e => e.MedianErrorMinutes);
        builder.Property(e => e.P10ErrorMinutes);
        builder.Property(e => e.P90ErrorMinutes);
        builder.Property(e => e.GeneratedAtUtc).IsRequired();

        // One aggregate per dimension combination per engine version; re-runs replace rather than duplicate.
        builder.HasIndex(e => new { e.AgeBandLabel, e.TypeKey, e.Phase, e.TemporalBucket, e.EngineVersion })
            .IsUnique()
            .HasDatabaseName("ix_community_prediction_aggregates_dimensions");

        // Readers typically look up by (age_band, type_key, phase) and take the latest temporal bucket.
        builder.HasIndex(e => new { e.AgeBandLabel, e.TypeKey, e.Phase, e.GeneratedAtUtc })
            .HasDatabaseName("ix_community_prediction_aggregates_lookup");
    }
}