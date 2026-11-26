using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using Lotties.Infrastructure.Persistence.Entities;
using Lotties.Infrastructure.Stores;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IPredictionOutcomeRepository"/> on the data plane: <c>prediction_outcomes</c> is a data table
/// (docs/design/47-bring-your-own-database.md), so every call goes to the store bound for the baby in <see cref="StoreScope"/> (the
/// baby must have been entered; <c>store_scope_missing</c> otherwise, never a fallback to the built-in store).
/// </summary>
internal sealed class EfPredictionOutcomeRepository(StoreScope stores) : IPredictionOutcomeRepository
{
    public async Task SaveAsync(PredictionOutcome outcome, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(outcome);
        var context = stores.ContextFor(outcome.BabyId);
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
        var rows = await stores.ContextFor(babyId).PredictionOutcomes
            .AsNoTracking()
            .Where(e => e.BabyId == babyId && e.TypeKey == typeKey.Value && !e.Resolved)
            .OrderBy(e => e.PredictedAt)
            .ToListAsync(cancellationToken);

        return rows.Select(MapToDomain).ToArray();
    }

    public async Task<IReadOnlyList<PredictionOutcome>> GetResolvedAsync(
        Guid babyId, EventTypeKey typeKey, int limit, CancellationToken cancellationToken = default)
    {
        var rows = await stores.ContextFor(babyId).PredictionOutcomes
            .AsNoTracking()
            .Where(e => e.BabyId == babyId && e.TypeKey == typeKey.Value && e.Resolved)
            .OrderByDescending(e => e.PredictedAt)
            .Take(limit)
            .ToListAsync(cancellationToken);

        return rows.Select(MapToDomain).ToArray();
    }

    private static PredictionOutcomeEntity MapToEntity(PredictionOutcome outcome) => new()
    {
        Id = outcome.Id,
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
        // An expired outcome is stored as resolved with no actual time and no error: it is no longer pending and every
        // accuracy query (which needs an error) leaves it out.
        Resolved = outcome.ActualNextStart is not null || outcome.Expired,
        IsRetrospective = outcome.IsRetrospective,
        IsTopUp = outcome.IsTopUp,
    };

    public async Task<double?> GetMaeAsync(
        Guid babyId, EventTypeKey typeKey, AgeBand? ageBand, DayPhase? phase, int minSamples, CancellationToken cancellationToken = default)
    {
        var query = stores.ContextFor(babyId).PredictionOutcomes.AsNoTracking()
            .Where(e => e.BabyId == babyId && e.TypeKey == typeKey.Value && e.Resolved && e.ErrorMinutes != null);

        if (ageBand.HasValue)
        {
            var bandStr = ageBand.Value.ToString();
            query = query.Where(e => e.AgeBand == bandStr);
        }

        if (phase.HasValue)
        {
            var phaseStr = phase.Value.ToString();
            query = query.Where(e => e.Phase == phaseStr);
        }

        var result = await query
            .GroupBy(e => 1)
            .Select(g => new { AvgError = g.Average(e => e.ErrorMinutes), Count = g.Count() })
            .FirstOrDefaultAsync(cancellationToken);

        return result is not null && result.Count >= minSamples ? result.AvgError : null;
    }

    public async Task InvalidateByAnchorAsync(
        Guid babyId, EventTypeKey typeKey, DateTimeOffset oldAnchorAt, CancellationToken cancellationToken = default)
    {
        var context = stores.ContextFor(babyId);
        var stale = await context.PredictionOutcomes
            .Where(e => e.BabyId == babyId && e.TypeKey == typeKey.Value && e.AnchorAt == oldAnchorAt && e.Resolved)
            .ToListAsync(cancellationToken);

        if (stale.Count > 0)
        {
            context.PredictionOutcomes.RemoveRange(stale);
            await context.SaveChangesAsync(cancellationToken);
        }
    }

    private static PredictionOutcome MapToDomain(PredictionOutcomeEntity entity) => new(
        entity.Id,
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
        entity.Phase is not null ? Enum.Parse<DayPhase>(entity.Phase, true) : null,
        entity.IsRetrospective,
        entity.IsTopUp,
        Expired: entity.Resolved && entity.ActualNextStart is null);

    public Task<bool> ExistsForAnchorAsync(
        Guid babyId, EventTypeKey typeKey, DateTimeOffset anchorAt, CancellationToken cancellationToken = default) =>
        stores.ContextFor(babyId).PredictionOutcomes.AsNoTracking()
            .AnyAsync(e => e.BabyId == babyId && e.TypeKey == typeKey.Value && e.AnchorAt == anchorAt, cancellationToken);

    public async Task<IReadOnlyList<PredictionOutcome>> GetResolvableByAsync(
        Guid babyId, EventTypeKey typeKey, DateTimeOffset eventStart, CancellationToken cancellationToken = default)
    {
        var rows = await stores.ContextFor(babyId).PredictionOutcomes
            .AsNoTracking()
            .Where(e => e.BabyId == babyId && e.TypeKey == typeKey.Value && e.AnchorAt < eventStart
                        && (!e.Resolved || (e.ActualNextStart != null && e.ActualNextStart > eventStart)))
            .OrderBy(e => e.AnchorAt)
            .ToListAsync(cancellationToken);

        return rows.Select(MapToDomain).ToArray();
    }

    public async Task<bool> TryResolveAsync(PredictionOutcome resolved, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(resolved);
        if (resolved.ActualNextStart is not { } actual)
        {
            throw new ArgumentException("A resolved outcome needs its actual next start.", nameof(resolved));
        }

        var error = resolved.ErrorMinutes;
        var written = await stores.ContextFor(resolved.BabyId).PredictionOutcomes
            .Where(e => e.Id == resolved.Id && e.BabyId == resolved.BabyId
                        && (!e.Resolved || (e.ActualNextStart != null && e.ActualNextStart > actual)))
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(e => e.ActualNextStart, actual)
                    .SetProperty(e => e.ErrorMinutes, error)
                    .SetProperty(e => e.Resolved, true),
                cancellationToken);
        return written > 0;
    }

    public Task<int> DeleteAnchoredBeforeAsync(
        Guid babyId, DateTimeOffset cutoff, CancellationToken cancellationToken = default) =>
        stores.ContextFor(babyId).PredictionOutcomes
            .Where(e => e.BabyId == babyId && e.AnchorAt < cutoff)
            .ExecuteDeleteAsync(cancellationToken);
}