namespace Lotties.Domain.Predictions;

/// <summary>Identifies which source dominates a blended prediction.</summary>
public enum BlendSource
{
    /// <summary>No personal data; the prior alone drives the prediction.</summary>
    PriorOnly,

    /// <summary>Both personal data and the prior contribute to the posterior.</summary>
    Blended,

    /// <summary>Enough personal data exists that the prior is effectively ignored.</summary>
    PersonalOnly,
}

/// <summary>The result of blending a personal median with a community or published prior via conjugate-normal shrinkage.</summary>
public sealed record BlendedResult(
    TimeSpan BlendedMedian,
    double EffectiveWeight,
    BlendSource Source);

/// <summary>
/// Pure Bayesian shrinkage that combines a baby's personal median with a prior (community or published norm).
/// Implements the conjugate-normal posterior from the Python benchmark <c>Shrinkage.posterior</c>:
/// <c>posterior_mean = (prior_precision * prior_mean + data_precision * data_mean) / (prior_precision + data_precision)</c>.
/// All math is deterministic and side-effect free.
/// </summary>
public static class BlendedPrior
{
    private const double MinLogSd = 0.01;
    private const double MaxLogSd = 10.0;
    private const double MinPersonalVariance = 1e-6;

    /// <summary>
    /// Blends a personal median with a prior median using conjugate-normal shrinkage on log-scale values.
    /// Returns a <see cref="BlendedResult"/> whose <see cref="BlendedResult.BlendedMedian"/> is the exponentiated posterior mean.
    /// </summary>
    /// <param name="personalMedian">The baby's recency-weighted median interval (or duration).</param>
    /// <param name="personalSampleCount">Effective number of personal samples contributing to the median.</param>
    /// <param name="personalLogSd">Log-standard-deviation of the personal samples (spread estimate).</param>
    /// <param name="priorMedian">The prior median (community or published norm).</param>
    /// <param name="priorLogSd">Log-standard-deviation of the prior (uncertainty).</param>
    /// <param name="options">Tuning constants including the kill switch and sample thresholds.</param>
    /// <param name="previousSmoothedWeight">
    /// The EMA-smoothed weight from the previous prediction for this type, or <c>null</c> on first call.
    /// Used to prevent oscillation near adaptive look-back regime boundaries.
    /// </param>
    public static BlendedResult Blend(
        TimeSpan personalMedian,
        int personalSampleCount,
        double personalLogSd,
        TimeSpan priorMedian,
        double priorLogSd,
        PredictionOptions options,
        double? previousSmoothedWeight = null)
    {
        // Kill switch: blending disabled -> personal data only (caller should not have called us, but be safe).
        if (!options.BlendingEnabled)
        {
            return new BlendedResult(personalMedian, 0.0, BlendSource.PersonalOnly);
        }

        // Guard against degenerate inputs.
        var safePersonalMedian = personalMedian > TimeSpan.Zero ? personalMedian : TimeSpan.FromMinutes(1);
        var safePriorMedian = priorMedian > TimeSpan.Zero ? priorMedian : TimeSpan.FromMinutes(1);
        var safePriorLogSd = Math.Clamp(priorLogSd, MinLogSd, MaxLogSd);
        var safePersonalLogSd = Math.Clamp(personalLogSd, MinLogSd, MaxLogSd);

        // Below minimum personal samples: prior only.
        if (personalSampleCount <= 0 || personalSampleCount < options.BlendingMinPersonalSamples)
        {
            return new BlendedResult(safePriorMedian, 1.0, BlendSource.PriorOnly);
        }

        // Above maximum personal samples: personal only.
        if (personalSampleCount >= options.BlendingMaxPersonalSamples)
        {
            return new BlendedResult(safePersonalMedian, 0.0, BlendSource.PersonalOnly);
        }

        // Conjugate-normal shrinkage on log scale.
        // Prior precision = 1 / exp(priorLogSd)^2 = exp(-2 * priorLogSd)
        // Data precision = n / exp(personalLogSd)^2 = n * exp(-2 * personalLogSd)
        var priorPrecision = Math.Exp(-2.0 * safePriorLogSd);
        var dataPrecision = personalSampleCount * Math.Exp(-2.0 * safePersonalLogSd);

        // Guard against zero total precision (should not happen with clamped inputs, but be defensive).
        var totalPrecision = priorPrecision + dataPrecision;
        if (totalPrecision < double.Epsilon)
        {
            return new BlendedResult(safePersonalMedian, 0.0, BlendSource.PersonalOnly);
        }

        var logPersonalMedian = Math.Log(safePersonalMedian.TotalMinutes);
        var logPriorMedian = Math.Log(safePriorMedian.TotalMinutes);

        var posteriorLogMean = (priorPrecision * logPriorMedian + dataPrecision * logPersonalMedian) / totalPrecision;
        var blendedMedian = TimeSpan.FromMinutes(Math.Exp(posteriorLogMean));

        // Effective weight of the prior in [0, 1]: prior_precision / total_precision.
        var rawWeight = priorPrecision / totalPrecision;

        // EMA smoothing to prevent oscillation when the adaptive look-back window shifts sample counts.
        var smoothedWeight = previousSmoothedWeight.HasValue
            ? options.BlendingEmaAlpha * rawWeight + (1.0 - options.BlendingEmaAlpha) * previousSmoothedWeight.Value
            : rawWeight;

        smoothedWeight = Math.Clamp(smoothedWeight, 0.0, 1.0);

        // Classify the source based on the smoothed weight.
        var source = smoothedWeight switch
        {
            >= 0.99 => BlendSource.PriorOnly,
            <= 0.01 => BlendSource.PersonalOnly,
            _ => BlendSource.Blended,
        };

        return new BlendedResult(blendedMedian, smoothedWeight, source);
    }

    /// <summary>
    /// Computes the posterior variance for diagnostic or confidence-interval use.
    /// Mirrors <c>Shrinkage.posterior</c>'s variance formula:
    /// <c>post_var = (prior_count * prior_var + n * data_spread) / (prior_count + n)</c>.
    /// </summary>
    public static double PosteriorLogVariance(
        int personalSampleCount,
        double personalLogSd,
        double priorLogSd,
        double priorPseudoCount = 2.0)
    {
        var safePriorLogSd = Math.Clamp(priorLogSd, MinLogSd, MaxLogSd);
        var safePersonalLogSd = Math.Clamp(personalLogSd, MinLogSd, MaxLogSd);

        var priorVar = safePriorLogSd * safePriorLogSd;
        var dataVar = safePersonalLogSd * safePersonalLogSd;

        if (personalSampleCount <= 0)
        {
            return priorVar;
        }

        return (priorPseudoCount * priorVar + personalSampleCount * dataVar) / (priorPseudoCount + personalSampleCount);
    }
}