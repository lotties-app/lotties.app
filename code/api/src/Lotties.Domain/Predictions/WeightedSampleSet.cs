namespace Lotties.Domain.Predictions;

/// <summary>
/// Pure Domain helper that combines personal samples with prior information to produce weighted quantiles.
/// Used by <see cref="TypePredictor"/> when <see cref="PredictionOptions.BlendingEnabled"/> is true.
/// All math is deterministic and side-effect free.
/// </summary>
internal static class WeightedSampleSet
{
    /// <summary>
    /// Computes a blended quantile by combining personal sample quantiles with a prior median using
    /// conjugate-normal shrinkage on the log scale. The personal quantile is computed from recency-weighted
    /// samples, then shrunk toward the prior according to the effective sample size and prior uncertainty.
    /// </summary>
    /// <param name="personalSamples">Recency-weighted personal samples (intervals or durations).</param>
    /// <param name="quantile">The target quantile (e.g. 0.5 for median).</param>
    /// <param name="now">Current time for recency weighting.</param>
    /// <param name="halfLife">Recency half-life for weighting personal samples.</param>
    /// <param name="priorMedian">The prior median to shrink toward.</param>
    /// <param name="priorLogSd">Log-standard-deviation of the prior (uncertainty).</param>
    /// <param name="options">Tuning constants including blending thresholds.</param>
    /// <param name="previousSmoothedWeight">EMA-smoothed weight from the previous prediction, or null on first call.</param>
    /// <returns>A <see cref="BlendedResult"/> with the blended quantile value as the median.</returns>
    public static BlendedResult BlendQuantile(
        IReadOnlyList<TimedSample> personalSamples,
        double quantile,
        DateTimeOffset now,
        TimeSpan halfLife,
        TimeSpan priorMedian,
        double priorLogSd,
        PredictionOptions options,
        double? previousSmoothedWeight = null,
        double? accuracyAdjustment = null)
    {
        if (!options.BlendingEnabled || personalSamples.Count == 0)
        {
            // No blending or no personal data: return prior only.
            if (personalSamples.Count == 0)
            {
                return new BlendedResult(priorMedian, 1.0, BlendSource.PriorOnly);
            }

            // Blending disabled: compute pure personal quantile.
            var purePersonal = WeightedStatistics.Quantile(personalSamples, quantile, now, halfLife);
            return new BlendedResult(purePersonal, 0.0, BlendSource.PersonalOnly);
        }

        // Compute personal quantile and effective sample count from recency weights.
        var personalQuantile = WeightedStatistics.Quantile(personalSamples, quantile, now, halfLife);
        var effectiveCount = EffectiveSampleCount(personalSamples, now, halfLife);

        // Estimate personal log-SD from the weighted samples.
        var personalLogSd = EstimateLogSd(personalSamples, now, halfLife);

        return BlendedPrior.Blend(
            personalQuantile,
            (int)Math.Round(effectiveCount),
            personalLogSd,
            priorMedian,
            priorLogSd,
            options,
            previousSmoothedWeight,
            accuracyAdjustment);
    }

    /// <summary>
    /// Computes the effective sample count from recency-weighted samples using the Kish formula:
    /// <c>n_eff = (sum(w))^2 / sum(w^2)</c>. This accounts for the fact that older samples
    /// contribute less information due to exponential decay.
    /// </summary>
    public static double EffectiveSampleCount(
        IReadOnlyList<TimedSample> samples,
        DateTimeOffset now,
        TimeSpan halfLife)
    {
        if (samples.Count == 0)
        {
            return 0.0;
        }

        var halfLifeDays = halfLife.TotalDays;
        if (halfLifeDays <= 0)
        {
            return samples.Count;
        }

        double sumW = 0;
        double sumW2 = 0;

        for (var i = 0; i < samples.Count; i++)
        {
            var ageDays = (now - samples[i].At).TotalDays;
            var weight = ageDays <= 0 ? 1.0 : Math.Pow(0.5, Math.Max(0, ageDays) / halfLifeDays);
            sumW += weight;
            sumW2 += weight * weight;
        }

        if (sumW2 < double.Epsilon)
        {
            return 0.0;
        }

        return sumW * sumW / sumW2;
    }

    /// <summary>
    /// Estimates the log-standard-deviation of recency-weighted samples.
    /// Returns a clamped value suitable for use as input to <see cref="BlendedPrior.Blend"/>.
    /// </summary>
    public static double EstimateLogSd(
        IReadOnlyList<TimedSample> samples,
        DateTimeOffset now,
        TimeSpan halfLife)
    {
        if (samples.Count < 2)
        {
            // Cannot estimate spread from fewer than 2 samples; return a moderate default.
            return 0.5;
        }

        var halfLifeDays = halfLife.TotalDays;
        var logValues = new double[samples.Count];
        var weights = new double[samples.Count];
        double sumW = 0;

        for (var i = 0; i < samples.Count; i++)
        {
            var minutes = Math.Max(samples[i].Length.TotalMinutes, 1.0);
            logValues[i] = Math.Log(minutes);
            var ageDays = (now - samples[i].At).TotalDays;
            weights[i] = halfLifeDays <= 0 ? 1.0 : Math.Pow(0.5, Math.Max(0, ageDays) / halfLifeDays);
            sumW += weights[i];
        }

        if (sumW < double.Epsilon)
        {
            return 0.5;
        }

        // Weighted mean of log values.
        double weightedMean = 0;
        for (var i = 0; i < logValues.Length; i++)
        {
            weightedMean += weights[i] * logValues[i];
        }

        weightedMean /= sumW;

        // Weighted variance of log values.
        double weightedVar = 0;
        for (var i = 0; i < logValues.Length; i++)
        {
            var diff = logValues[i] - weightedMean;
            weightedVar += weights[i] * diff * diff;
        }

        weightedVar /= sumW;

        var logSd = Math.Sqrt(Math.Max(0, weightedVar));
        return Math.Clamp(logSd, 0.01, 10.0);
    }
}