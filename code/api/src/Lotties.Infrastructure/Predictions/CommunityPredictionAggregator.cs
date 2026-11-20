using Lotties.Domain.Predictions;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Predictions;

/// <summary>
/// Aggregates resolved prediction outcomes into anonymized community aggregates (docs/design/34-community-insights.md).
/// Reads from <c>prediction_outcomes</c> (which ARE linked to babies), groups by (age_band, type_key, phase, temporal_bucket),
/// applies the suppression threshold (<see cref="CommunityPredictionAggregate.MinimumCount"/>), and writes to
/// <c>community_prediction_aggregates</c>. The output table contains NO baby_id or PII.
/// </summary>
/// <remarks>
/// Lives in Infrastructure because it needs direct DbContext access for bulk reads and upserts.
/// Callable from <see cref="Application.CommunityInsights.CommunityAggregationJob"/> or as a standalone step.
/// Re-runs for the same temporal bucket upsert (the unique constraint on dimensions prevents duplicates).
/// </remarks>
internal sealed class CommunityPredictionAggregator(
    LottiesDbContext context,
    TimeProvider time,
    ILogger<CommunityPredictionAggregator> logger) : ICommunityPredictionAggregator
{
    /// <summary>
    /// Runs the aggregation pipeline: loads resolved outcomes, groups by dimensions, computes metrics,
    /// applies suppression, and upserts to the aggregates table. Returns the number of aggregates written.
    /// </summary>
    public async Task<int> AggregateAsync(CancellationToken cancellationToken = default)
    {
        var now = time.GetUtcNow();
        var temporalBucket = $"{now:yyyy-'W'ww}";

        // Load resolved outcomes with non-null error and age band.
        // Outcomes without an age band or error cannot contribute to community priors.
        var resolvedOutcomes = await context.PredictionOutcomes
            .Where(o => o.Resolved
                        && o.ErrorMinutes != null
                        && o.AgeBand != null)
            .Select(o => new
            {
                o.TypeKey,
                o.Phase,
                o.AgeBand,
                o.EngineVersion,
                ErrorMinutes = o.ErrorMinutes!.Value,
            })
            .ToListAsync(cancellationToken);

        if (resolvedOutcomes.Count == 0)
        {
            logger.LogInformation("No resolved prediction outcomes available for community aggregation");
            return 0;
        }

        // Group by dimensions and compute aggregate metrics.
        var grouped = resolvedOutcomes
            .GroupBy(o => new { o.AgeBand, o.TypeKey, o.Phase, o.EngineVersion })
            .Select(g =>
            {
                var errors = g.Select(x => Math.Abs(x.ErrorMinutes)).OrderBy(e => e).ToList();
                var count = errors.Count;
                var sumError = errors.Sum();
                var sumSquared = errors.Sum(e => e * e);
                var median = Percentile(errors, 50);
                var p10 = Percentile(errors, 10);
                var p90 = Percentile(errors, 90);

                return new
                {
                    g.Key.AgeBand,
                    g.Key.TypeKey,
                    g.Key.Phase,
                    g.Key.EngineVersion,
                    Count = count,
                    SumError = sumError,
                    SumSquared = sumSquared,
                    Median = median,
                    P10 = p10,
                    P90 = p90,
                };
            })
            .ToList();

        // Apply suppression threshold: only store aggregates with enough contributions.
        var eligible = grouped
            .Where(g => g.Count >= CommunityPredictionAggregate.MinimumCount)
            .ToList();

        var suppressed = grouped.Count - eligible.Count;
        if (suppressed > 0)
        {
            logger.LogInformation(
                "Suppressed {Suppressed} community prediction aggregate cells below minimum count {Threshold}",
                suppressed, CommunityPredictionAggregate.MinimumCount);
        }

        if (eligible.Count == 0)
        {
            logger.LogInformation("No community prediction aggregates met the suppression threshold");
            return 0;
        }

        // Upsert each aggregate: match on dimensions, insert or update.
        var written = 0;
        foreach (var agg in eligible)
        {
            var existing = await context.CommunityPredictionAggregates
                .FirstOrDefaultAsync(e =>
                    e.AgeBandLabel == agg.AgeBand
                    && e.TypeKey == agg.TypeKey
                    && e.Phase == agg.Phase
                    && e.TemporalBucket == temporalBucket
                    && e.EngineVersion == agg.EngineVersion,
                    cancellationToken);

            if (existing is not null)
            {
                existing.Count = agg.Count;
                existing.SumErrorMinutes = agg.SumError;
                existing.SumSquaredError = agg.SumSquared;
                existing.MedianErrorMinutes = agg.Median;
                existing.P10ErrorMinutes = agg.P10;
                existing.P90ErrorMinutes = agg.P90;
                existing.GeneratedAtUtc = now;
            }
            else
            {
                context.CommunityPredictionAggregates.Add(new CommunityPredictionAggregateEntity
                {
                    Id = Guid.NewGuid(),
                    AgeBandLabel = agg.AgeBand!,
                    TypeKey = agg.TypeKey,
                    Phase = agg.Phase,
                    TemporalBucket = temporalBucket,
                    EngineVersion = agg.EngineVersion,
                    Count = agg.Count,
                    SumErrorMinutes = agg.SumError,
                    SumSquaredError = agg.SumSquared,
                    MedianErrorMinutes = agg.Median,
                    P10ErrorMinutes = agg.P10,
                    P90ErrorMinutes = agg.P90,
                    GeneratedAtUtc = now,
                });
            }

            written++;
        }

        await context.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Wrote {Count} community prediction aggregates for bucket {Bucket}", written, temporalBucket);
        return written;
    }

    /// <summary>Computes the p-th percentile of a sorted list using linear interpolation.</summary>
    private static double? Percentile(List<double> sortedValues, int percentile)
    {
        if (sortedValues.Count == 0)
        {
            return null;
        }

        if (sortedValues.Count == 1)
        {
            return sortedValues[0];
        }

        var index = (percentile / 100.0) * (sortedValues.Count - 1);
        var lower = (int)Math.Floor(index);
        var upper = (int)Math.Ceiling(index);
        var fraction = index - lower;

        return sortedValues[lower] + fraction * (sortedValues[upper] - sortedValues[lower]);
    }
}