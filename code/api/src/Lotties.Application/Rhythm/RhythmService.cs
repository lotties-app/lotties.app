using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;
using Lotties.Domain.Rhythm;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Rhythm;

/// <summary>
/// Reads the baby's events of the rhythm window through the predictions' history repository (store-scoped, soft-deleted
/// events excluded) and measures the rhythm. Logs only the baby id and counts.
/// </summary>
internal sealed class RhythmService(IPredictionHistoryRepository history, ILogger<RhythmService> logger) : IRhythmService
{
    private readonly IPredictionHistoryRepository _history = history ?? throw new ArgumentNullException(nameof(history));
    private readonly ILogger<RhythmService> _logger = logger ?? throw new ArgumentNullException(nameof(logger));

    public async Task<RhythmResponse?> GetAsync(Guid babyId, DateTimeOffset now, string? timeZone = null, CancellationToken cancellationToken = default)
    {
        var clock = LocalClock.ForZoneOrOffset(timeZone, now.Offset);
        var stored = await _history.LoadAsync(babyId, BabyRhythm.LoadSince(now, clock, RhythmOptions.Default), cancellationToken);
        if (stored is null)
        {
            _logger.LogDebug("Rhythm requested for unknown baby {BabyId}", babyId);
            return null;
        }

        var rhythm = BabyRhythm.Measure(stored.Events, now, clock, RhythmOptions.Default);
        _logger.LogDebug("Computed the rhythm of baby {BabyId} from {EventCount} events ({NightCount} nights)", babyId, stored.Events.Count, rhythm.Nights.Count);
        return RhythmResponse.Create(babyId, now, clock, rhythm, RhythmOptions.Default);
    }
}
