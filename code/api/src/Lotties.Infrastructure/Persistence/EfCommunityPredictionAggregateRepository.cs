using Lotties.Domain.Predictions;
using Lotties.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence;

/// <summary>
/// EF Core implementation of <see cref="ICommunityPredictionAggregateRepository"/>.
/// Reads from <c>community_prediction_aggregates</c>; returns only non-suppressed aggregates (count >= MinimumCount).
/// </summary>
internal sealed class EfCommunityPredictionAggregateRepository(LottiesDbContext context) : ICommunityPredictionAggregateRepository
{
    public async Task<CommunityPredictionAggregate?> GetAggregateAsync(
        AgeBand ageBand,
        string typeKey,
        DayPhase? phase,
        CancellationToken cancellationToken = default)
    {
        var ageBandLabel = AgeBands.Label(ageBand);
        var phaseValue = phase?.ToString().ToLowerInvariant();

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
        var ageBand = entity.AgeBandLabel switch
        {
            "0-3m" => AgeBand.UnderThreeMonths,
            "3-6m" => AgeBand.ThreeToSixMonths,
            "6-12m" => AgeBand.SixToTwelveMonths,
            "12m+" => AgeBand.TwelveMonthsPlus,
            _ => throw new InvalidOperationException($"Unknown age band label: {entity.AgeBandLabel}"),
        };

        DayPhase? phase = entity.Phase is null ? null : Enum.Parse<DayPhase>(entity.Phase, ignoreCase: true);

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