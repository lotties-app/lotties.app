namespace Lotties.Domain.Predictions;

/// <summary>The samples a statistic is computed from, and which buckets narrowed them.</summary>
internal sealed record SampleSelection(IReadOnlyList<TimedSample> Samples, AgeBand? AgeBand, DayPhase? Phase);

/// <summary>
/// Narrows samples to the baby's current age band and to the day/night phase of a reference instant, each only when
/// the narrowed set keeps <see cref="PredictionOptions.MinimumBucketSamples"/>; otherwise the wider set is kept.
/// Too-short samples are dropped first and outliers (relative to the selection's plain median) last.
/// </summary>
internal sealed class SampleSelector(PredictionContext context, PredictionOptions options, bool splitsDayAndNight)
{
    private readonly AgeBand _currentBand = AgeBands.At(context.BirthDate, context.LocalDateOf(context.Now));

    public SampleSelection Select(IEnumerable<TimedSample> candidates, DateTimeOffset reference)
    {
        var usable = candidates.Where(sample => sample.Length >= options.MinimumSampleLength).ToArray();
        var byBand = NarrowToBand(usable);
        var byPhase = NarrowToPhase(byBand, reference);
        return byPhase with { Samples = RemoveOutliers(byPhase.Samples) };
    }

    private SampleSelection NarrowToBand(IReadOnlyList<TimedSample> samples)
    {
        var inBand = samples.Where(sample => AgeBands.At(context.BirthDate, context.LocalDateOf(sample.At)) == _currentBand).ToArray();
        return inBand.Length >= options.MinimumBucketSamples
            ? new SampleSelection(inBand, _currentBand, null)
            : new SampleSelection(samples, null, null);
    }

    private SampleSelection NarrowToPhase(SampleSelection selection, DateTimeOffset reference)
    {
        if (!splitsDayAndNight)
        {
            return selection;
        }

        var phase = DayPhases.Of(reference, context.LocalOffset, options);

        // When the current time falls in the night phase but we're predicting awake windows
        // (sleep/naps), use a daytime reference so we select nap-relevant samples rather than
        // night-sleep samples. Without this, checking the app after NightStartsAt would filter
        // to night-only samples and return insufficient data despite abundant daytime naps.
        // The TypePredictor already applies this fix for its own reference; this ensures the
        // SampleSelector also respects it when called from other paths (e.g., diaper predictions).
        if (phase == DayPhase.Night && splitsDayAndNight)
        {
            var todayNoon = new DateTimeOffset(context.LocalDateOf(context.Now), new TimeOnly(12, 0), context.LocalOffset);
            phase = DayPhases.Of(todayNoon, context.LocalOffset, options);
        }

        var inPhase = selection.Samples.Where(sample => DayPhases.Of(sample.At, context.LocalOffset, options) == phase).ToArray();
        return inPhase.Length >= options.MinimumBucketSamples
            ? selection with { Samples = inPhase, Phase = phase }
            : selection;
    }

    private IReadOnlyList<TimedSample> RemoveOutliers(IReadOnlyList<TimedSample> samples)
    {
        if (samples.Count == 0)
        {
            return samples;
        }

        var limit = WeightedStatistics.PlainMedian(samples) * options.OutlierFactor;
        return samples.Where(sample => sample.Length <= limit).ToArray();
    }
}
