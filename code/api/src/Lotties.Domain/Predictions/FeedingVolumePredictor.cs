namespace Lotties.Domain.Predictions;

/// <summary>A feeding volume prediction for one (age band, day phase) bucket.</summary>
public sealed record FeedingVolumePrediction(
    double MedianVolumeMl,
    double LowerBoundMl,
    double UpperBoundMl,
    int SampleCount,
    AgeBand? AgeBand,
    DayPhase? DayPhase);

/// <summary>
/// Pure domain predictor of feeding volumes from past bottle feeds. Groups finished feeding events by (age band, day
/// phase) and computes median volume with IQR bounds per bucket. No I/O.
/// </summary>
public static class FeedingVolumePredictor
{
    /// <summary>Fewest samples a bucket needs before its statistics are returned.</summary>
    public const int MinimumSamples = 5;

    /// <summary>
    /// Predicts feeding volumes from finished feeding events that carry a <see cref="ObservedEvent.VolumeMl"/>.
    /// Returns one prediction per (age band, day phase) bucket that has at least <see cref="MinimumSamples"/> samples,
    /// or <c>null</c> when no bucket qualifies.
    /// </summary>
    public static IReadOnlyList<FeedingVolumePrediction>? Predict(
        IReadOnlyList<ObservedEvent> feedingEvents,
        PredictionContext context,
        PredictionOptions options)
    {
        ArgumentNullException.ThrowIfNull(feedingEvents);
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(options);

        var volumes = feedingEvents
            .Where(e => e.VolumeMl is not null && e.VolumeMl > 0 && e.EndedAt is not null)
            .Select(e => new VolumeSample(e.VolumeMl!.Value, e.StartedAt))
            .ToArray();

        if (volumes.Length == 0)
        {
            return null;
        }

        var results = new List<FeedingVolumePrediction>();

        // Try narrowing to current age band first.
        var currentBand = AgeBands.At(context.BirthDate, context.LocalDateOf(context.Now));
        var inBand = volumes.Where(v => AgeBands.At(context.BirthDate, context.LocalDateOf(v.At)) == currentBand).ToArray();

        if (inBand.Length >= MinimumSamples)
        {
            // Further narrow by day/night phase.
            var currentPhase = DayPhases.Of(context.Now, context.LocalOffset, options);
            var inBandAndPhase = inBand.Where(v => DayPhases.Of(v.At, context.LocalOffset, options) == currentPhase).ToArray();

            if (inBandAndPhase.Length >= MinimumSamples)
            {
                results.Add(BuildPrediction(inBandAndPhase, currentBand, currentPhase));
            }
            else
            {
                results.Add(BuildPrediction(inBand, currentBand, null));
            }
        }
        else
        {
            // Fall back to all data without band/phase narrowing.
            if (volumes.Length >= MinimumSamples)
            {
                results.Add(BuildPrediction(volumes, null, null));
            }
        }

        return results.Count > 0 ? results : null;
    }

    private static FeedingVolumePrediction BuildPrediction(IReadOnlyList<VolumeSample> samples, AgeBand? band, DayPhase? phase)
    {
        var ordered = samples.Select(s => s.VolumeMl).Order().ToArray();
        var median = Quantile(ordered, 0.5);
        var lower = Quantile(ordered, 0.25);
        var upper = Quantile(ordered, 0.75);
        return new FeedingVolumePrediction(median, lower, upper, ordered.Length, band, phase);
    }

    private static double Quantile(double[] ordered, double quantile)
    {
        if (ordered.Length == 1)
        {
            return ordered[0];
        }

        var position = quantile * (ordered.Length - 1);
        var lower = (int)Math.Floor(position);
        var upper = Math.Min(lower + 1, ordered.Length - 1);
        var fraction = position - lower;
        return ordered[lower] + ((ordered[upper] - ordered[lower]) * fraction);
    }

    private readonly record struct VolumeSample(double VolumeMl, DateTimeOffset At);
}