using Lotties.Domain.Predictions;
using Lotties.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence;

/// <summary>
/// EF Core implementation of <see cref="ICommunityPredictionAggregateRepository"/>.
/// Reads from <c>community_prediction_aggregates</c>; returns only non-suppressed aggregates (count >= MinimumCount). The labels it
/// looks up and maps back are those the aggregator writes (<see cref="CommunityPredictionAggregateLabels"/>).
/// Not registered in DI (docs/design/33-privacy-audit.md section 20.1).
/// </summary>
internal sealed class EfCommunityPredictionAggregateRepository(LottiesDbContext context) : ICommunityPredictionAggregateRepository
{
    public async Task<CommunityPredictionAggregate?> GetAggregateAsync(
        AgeBand ageBand,
        string typeKey,
        DayPhase? phase,
        CancellationToken cancellationToken = default)
    {
        var ageBandLabel = CommunityPredictionAggregateLabels.OfAgeBand(ageBand);
        var phaseValue = CommunityPredictionAggregateLabels.OfPhase(phase);

        // Take the most recent non-suppressed aggregate for these dimensions.
        var entity = await context.CommunityPredictionAggregates
            .Where(e => e.AgeBandLabel == ageBandLabel
                        && e.TypeKey == typeKey
                        && e.Phase == phaseValue
                        && e.Count >= CommunityPredictionAggregate.MinimumCount)
            .OrderByDescending(e => e.GeneratedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);

        return entity is null ? null : MapToDomain(entity);
    }

    private static CommunityPredictionAggregate MapToDomain(CommunityPredictionAggregateEntity entity)
    {
        var ageBand = CommunityPredictionAggregateLabels.AgeBandOf(entity.AgeBandLabel);
        var phase = CommunityPredictionAggregateLabels.PhaseOf(entity.Phase);

        return new CommunityPredictionAggregate(
            AgeBand: ageBand,
            TypeKey: entity.TypeKey,
            Phase: phase,
            TemporalBucket: entity.TemporalBucket,
            EngineVersion: entity.EngineVersion,
            Count: entity.Count,
            SumErrorMinutes: entity.SumErrorMinutes,
            SumSquaredError: entity.SumSquaredError,
            MedianErrorMinutes: entity.MedianErrorMinutes,
            P10ErrorMinutes: entity.P10ErrorMinutes,
            P90ErrorMinutes: entity.P90ErrorMinutes,
            GeneratedAtUtc: entity.GeneratedAtUtc);
    }
}