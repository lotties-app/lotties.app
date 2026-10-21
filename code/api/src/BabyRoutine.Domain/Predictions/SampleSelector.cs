namespace BabyRoutine.Domain.Predictions;

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
