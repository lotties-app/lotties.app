namespace Lotties.Domain.Predictions;

/// <summary>A predicted feeding duration for a given volume, from linear regression within an age band.</summary>
public sealed record FeedingDurationPrediction(
    double ExpectedDurationMinutes,
    double VolumeMl,
    int SampleCount,
    AgeBand? AgeBand);

/// <summary>
/// Pure domain predictor of feeding duration from volume. Uses simple linear regression (duration ~ volume) within the
/// baby's current age band when enough samples exist. No I/O.
/// </summary>
public static class FeedingDurationPredictor
{
    /// <summary>Fewest finished feeding events with both volume and duration needed to fit a regression.</summary>
    public const int MinimumSamples = 5;

    /// <summary>
    /// Predicts how long a feeding of <paramref name="targetVolumeMl"/> will take, based on past finished feedings that
    /// carry both a volume and a duration. Returns <c>null</c> when fewer than <see cref="MinimumSamples"/> qualifying
    /// events exist in the current age band (or across all data when the band is too sparse).
    /// </summary>
    public static FeedingDurationPrediction? Predict(
        IReadOnlyList<ObservedEvent> feedingEvents,
        double targetVolumeMl,
        PredictionContext context,
        PredictionOptions options)
    {
        ArgumentNullException.ThrowIfNull(feedingEvents);
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(options);

        if (targetVolumeMl <= 0)
        {
            return null;
        }

        var samples = feedingEvents
            .Where(e => e.VolumeMl is not null && e.VolumeMl > 0 && e.EffectiveDuration is not null && e.EffectiveDuration > TimeSpan.Zero)
            .Select(e => new RegressionSample(e.VolumeMl!.Value, e.EffectiveDuration!.Value.TotalMinutes, e.StartedAt))
            .ToArray();

        if (samples.Length == 0)
        {
            return null;
        }

        var currentBand = AgeBands.At(context.BirthDate, context.LocalDateOf(context.Now));
        var inBand = samples.Where(s => AgeBands.At(context.BirthDate, context.LocalDateOf(s.At)) == currentBand).ToArray();

        var usable = inBand.Length >= MinimumSamples ? inBand : samples;
        if (usable.Length < MinimumSamples)
        {
            return null;
        }

        var (intercept, slope) = FitLinearRegression(usable);
        var expectedMinutes = Math.Max(1, intercept + (slope * targetVolumeMl));
        var band = inBand.Length >= MinimumSamples ? currentBand : (AgeBand?)null;
        return new FeedingDurationPrediction(Math.Round(expectedMinutes, 1, MidpointRounding.AwayFromZero), targetVolumeMl, usable.Length, band);
    }

    private static (double Intercept, double Slope) FitLinearRegression(IReadOnlyList<RegressionSample> samples)
    {
        var n = samples.Count;
        var sumX = 0.0;
        var sumY = 0.0;
        var sumXY = 0.0;
        var sumXX = 0.0;

        for (var i = 0; i < n; i++)
        {
            var x = samples[i].VolumeMl;
            var y = samples[i].DurationMinutes;
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
        }

        var denominator = (n * sumXX) - (sumX * sumX);
        if (Math.Abs(denominator) < 1e-12)
        {
            // All volumes identical: predict the mean duration regardless of volume.
            return (sumY / n, 0);
        }

        var slope = ((n * sumXY) - (sumX * sumY)) / denominator;
        var intercept = (sumY - (slope * sumX)) / n;
        return (intercept, slope);
    }

    private readonly record struct RegressionSample(double VolumeMl, double DurationMinutes, DateTimeOffset At);
}