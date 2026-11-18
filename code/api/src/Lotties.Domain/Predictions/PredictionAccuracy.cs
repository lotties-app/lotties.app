namespace Lotties.Domain.Predictions;

/// <summary>Mean absolute error of resolved predictions within a single (type, age band, phase) bucket.</summary>
/// <param name="MaeMinutes">Mean absolute error in minutes across all resolved outcomes in this bucket.</param>
/// <param name="ResolvedCount">Number of resolved outcomes that contributed to the MAE.</param>
/// <param name="AgeBand">The age band bucket, or <c>null</c> when not narrowed by age.</param>
/// <param name="Phase">The day/night phase bucket, or <c>null</c> when not narrowed by phase.</param>
internal sealed record PredictionAccuracy(double MaeMinutes, int ResolvedCount, AgeBand? AgeBand, DayPhase? Phase);

/// <summary>Pure computation of prediction accuracy from resolved outcomes.</summary>
internal static class PredictionAccuracyCalculator
{
    /// <summary>
    /// Computes the mean absolute error over resolved outcomes. Returns <c>null</c> when no outcomes have an error.
    /// The bucket dimensions are taken from the first resolved outcome.
    /// </summary>
    public static PredictionAccuracy? Compute(IReadOnlyList<PredictionOutcome> resolvedOutcomes)
    {
        ArgumentNullException.ThrowIfNull(resolvedOutcomes);

        var resolved = resolvedOutcomes.Where(o => o.ErrorMinutes is not null).ToList();
        if (resolved.Count == 0)
        {
            return null;
        }

        var mae = resolved.Average(o => o.ErrorMinutes!.Value);
        var first = resolved[0];
        return new PredictionAccuracy(mae, resolved.Count, first.AgeBand, first.Phase);
    }
}