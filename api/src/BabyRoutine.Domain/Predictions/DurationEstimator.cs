namespace BabyRoutine.Domain.Predictions;

/// <summary>
/// Typical (recency-weighted median) duration of finished events, narrowed like every other sample by
/// <see cref="SampleSelector"/> (age band, then day/night phase of the reference start, each only with enough samples).
/// Running events are ignored.
/// </summary>
internal sealed class DurationEstimator(IReadOnlyList<ObservedEvent> events, SampleSelector selector, PredictionContext context, PredictionOptions options)
{
    private const double MedianQuantile = 0.5;

    /// <param name="start">The start of the event whose duration is estimated; decides the day/night phase.</param>
    /// <param name="kind">Only sleep sessions of this kind (heuristic v1.1), or <c>null</c> for every event.</param>
    /// <returns>The estimate, or <c>null</c> with fewer than <see cref="PredictionOptions.MinimumSamples"/> samples.</returns>
    public DurationEstimate? Estimate(DateTimeOffset start, SleepSessionKind? kind)
    {
        var durations = events
            .Where(item => item.EndedAt is not null)
            .Where(item => kind is null || SleepSessionKinds.Of(item) == kind)
            .Select(item => new TimedSample(item.EndedAt!.Value - item.StartedAt, item.StartedAt));
        var selection = selector.Select(durations, start);
        return selection.Samples.Count < options.MinimumSamples
            ? null
            : new DurationEstimate(Median(selection.Samples), selection.Samples.Count);
    }

    private TimeSpan Median(IReadOnlyList<TimedSample> samples) =>
        WeightedStatistics.RoundToMinute(WeightedStatistics.Quantile(samples, MedianQuantile, context.Now, options.RecencyHalfLife));
}
