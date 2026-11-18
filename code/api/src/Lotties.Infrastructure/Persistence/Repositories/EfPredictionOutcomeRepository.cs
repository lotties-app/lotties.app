using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using Lotties.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <summary>EF Core implementation of <see cref="IPredictionOutcomeRepository"/> using the control-plane context.</summary>
internal sealed class EfPredictionOutcomeRepository(LottiesDbContext context) : IPredictionOutcomeRepository
{
    public async Task SaveAsync(PredictionOutcome outcome, CancellationToken cancellationToken = default)
    {
        var entity = MapToEntity(outcome);
        var existing = await context.PredictionOutcomes
            .FirstOrDefaultAsync(e => e.Id == entity.Id, cancellationToken);

        if (existing is not null)
        {
            existing.ActualNextStart = entity.ActualNextStart;
            existing.ErrorMinutes = entity.ErrorMinutes;
            existing.Resolved = entity.Resolved;
        }
        else
        {
            context.PredictionOutcomes.Add(entity);
        }

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PredictionOutcome>> GetPendingAsync(
        Guid babyId, EventTypeKey typeKey, CancellationToken cancellationToken = default)
    {
        var rows = await context.PredictionOutcomes
            .AsNoTracking()
            .Where(e => e.BabyId == babyId && e.TypeKey == typeKey.Value && !e.Resolved)
            .OrderBy(e => e.PredictedAt)
            .ToListAsync(cancellationToken);

        return rows.Select(MapToDomain).ToArray();
    }

    public async Task<IReadOnlyList<PredictionOutcome>> GetResolvedAsync(
        Guid babyId, EventTypeKey typeKey, int limit, CancellationToken cancellationToken = default)
    {
        var rows = await context.PredictionOutcomes
            .AsNoTracking()
            .Where(e => e.BabyId == babyId && e.TypeKey == typeKey.Value && e.Resolved)
            .OrderByDescending(e => e.PredictedAt)
            .Take(limit)
            .ToListAsync(cancellationToken);

        return rows.Select(MapToDomain).ToArray();
    }

    private static PredictionOutcomeEntity MapToEntity(PredictionOutcome outcome) => new()
    {
        Id = Guid.NewGuid(),
        BabyId = outcome.BabyId,
        TypeKey = outcome.TypeKey.Value,
        PredictedAt = outcome.PredictedAt,
        AnchorAt = outcome.AnchorAt,
        ExpectedNextStart = outcome.ExpectedNextStart,
        ActualNextStart = outcome.ActualNextStart,
        ErrorMinutes = outcome.ErrorMinutes,
        EngineVersion = outcome.EngineVersion,
        SampleCount = outcome.SampleCount,
        AgeBand = outcome.AgeBand?.ToString(),
        Phase = outcome.Phase?.ToString(),
        Resolved = outcome.ActualNextStart is not null,
    };

    private static PredictionOutcome MapToDomain(PredictionOutcomeEntity entity) => new(
        entity.BabyId,
        EventTypeKey.From(entity.TypeKey),
        entity.PredictedAt,
        entity.AnchorAt,
        entity.ExpectedNextStart,
        entity.ActualNextStart,
        entity.ErrorMinutes,
        entity.EngineVersion,
        entity.SampleCount,
        entity.AgeBand is not null ? Enum.Parse<AgeBand>(entity.AgeBand, true) : null,
        entity.Phase is not null ? Enum.Parse<DayPhase>(entity.Phase, true) : null);
}