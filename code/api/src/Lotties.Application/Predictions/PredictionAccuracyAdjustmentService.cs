using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Predictions;

/// <summary>
/// Computes an accuracy-based weight adjustment for <see cref="BlendedPrior.Blend"/> from historical prediction
/// outcomes stored in <see cref="IPredictionOutcomeRepository"/>. The adjustment is derived from per-bucket MAE:
/// high MAE (prior has been inaccurate) produces a positive value that reduces prior weight; low MAE (prior has
/// been accurate) produces a negative value that increases prior weight. Returns null when insufficient data exists.
/// </summary>
internal sealed class PredictionAccuracyAdjustmentService(
    IPredictionOutcomeRepository repository,
    PredictionOptions options,
    ILogger<PredictionAccuracyAdjustmentService> logger)
{
    /// <summary>Minimum resolved outcomes required to compute a meaningful accuracy adjustment.</summary>
    private const int MinSamplesForAdjustment = 10;

    /// <summary>
    /// MAE threshold (minutes) above which the prior is considered inaccurate and its weight should be reduced.
    /// Derived from the synthetic study: typical sleep prediction error of ~60 min is "acceptable"; above 120 min
    /// the prior is actively hurting predictions.
    /// </summary>
    private const double HighMaeThresholdMinutes = 120.0;

    /// <summary>
    /// MAE threshold (minutes) below which the prior is considered accurate and its weight should be increased.
    /// Below 30 min the prior is providing strong signal.
    /// </summary>
    private const double LowMaeThresholdMinutes = 30.0;

    /// <summary>
    /// Computes the accuracy adjustment for a given baby, event type, age band, and day phase.
    /// Returns null when fewer than <see cref="MinSamplesForAdjustment"/> resolved outcomes exist for the bucket,
    /// or when accuracy tracking is disabled.
    /// </summary>
    public async Task<double?> GetAccuracyAdjustmentAsync(
        Guid babyId,
        EventTypeKey typeKey,
        AgeBand? ageBand,
        DayPhase? phase,
        CancellationToken cancellationToken = default)
    {
        if (!options.AccuracyTrackingEnabled)
        {
            return null;
        }

        try
        {
            var mae = await repository.GetMaeAsync(babyId, typeKey, ageBand, phase, MinSamplesForAdjustment, cancellationToken);
            if (mae is null)
            {
                return null;
            }

            // Map MAE to an adjustment in [-0.5, 0.5]:
            // - MAE <= LowMaeThreshold: adjustment = -0.5 (strongly trust the prior)
            // - MAE >= HighMaeThreshold: adjustment = +0.5 (strongly distrust the prior)
            // - Between: linear interpolation
            double adjustment;
            if (mae.Value <= LowMaeThresholdMinutes)
            {
                adjustment = -0.5;
            }
            else if (mae.Value >= HighMaeThresholdMinutes)
            {
                adjustment = 0.5;
            }
            else
            {
                // Linear map from [LowMae, HighMae] -> [-0.5, +0.5]
                var normalized = (mae.Value - LowMaeThresholdMinutes) / (HighMaeThresholdMinutes - LowMaeThresholdMinutes);
                adjustment = -0.5 + normalized;
            }

            logger.LogDebug(
                "Accuracy adjustment for baby {BabyId} type {TypeKey} ageBand {AgeBand} phase {Phase}: MAE={Mae:F1}min -> adjustment={Adjustment:F3}",
                babyId,
                typeKey.Value,
                ageBand?.ToString() ?? "all",
                phase?.ToString() ?? "all",
                mae.Value,
                adjustment);

            return adjustment;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to compute accuracy adjustment for baby {BabyId} type {TypeKey}", babyId, typeKey.Value);
            return null;
        }
    }
}