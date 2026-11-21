namespace Lotties.Domain.Predictions;

/// <summary>
/// Adapts the look-back window per type based on sample density: extends when too few usable gaps exist (sparse loggers),
/// shrinks when recent data is much noisier than older data (regime change signal). Pure, deterministic, order-independent.
/// </summary>
internal static class AdaptiveLookBack
{
    /// <summary>Step size when extending the window to find more samples.</summary>
    private static readonly TimeSpan ExtensionStep = TimeSpan.FromDays(7);

    /// <summary>
    /// Returns the effective look-back for one event type. When adaptation is disabled or there are no events, returns
    /// <see cref="PredictionOptions.LookBack"/> unchanged. The result is clamped to
    /// [<see cref="PredictionOptions.MinLookBack"/>, <see cref="PredictionOptions.MaxLookBack"/>] and never extends before
    /// the baby's birth date.
    /// </summary>
    public static TimeSpan Resolve(
        IReadOnlyList<ObservedEvent> chronological,
        PredictionContext context,
        PredictionOptions options)
    {
        if (!options.LookBackAdaptationEnabled || chronological.Count == 0)
        {
            return options.LookBack;
        }

        var adapted = TryShrink(chronological, context, options) ?? TryExtend(chronological, context, options) ?? options.LookBack;
        return Clamp(ClampToAge(adapted, context), options.MinLookBack, options.MaxLookBack);
    }

    /// <summary>
    /// Shrinks to <see cref="PredictionOptions.MinLookBack"/> when the coefficient of variation of the most recent half
    /// exceeds twice the CV of the older half: the older data is from a different regime (coarse regime-change signal).
    /// Returns <c>null</c> when there is no reason to shrink.
    /// </summary>
    private static TimeSpan? TryShrink(IReadOnlyList<ObservedEvent> chronological, PredictionContext context, PredictionOptions options)
    {
        if (chronological.Count < options.MinimumSamples * 2)
        {
            return null;
        }

        var midpoint = chronological[^1].StartedAt - options.LookBack / 2;
        var recent = chronological.Where(item => item.StartedAt >= midpoint).ToArray();
        var older = chronological.Where(item => item.StartedAt < midpoint).ToArray();
        if (recent.Length < options.MinimumSamples || older.Length < options.MinimumSamples)
        {
            return null;
        }

        var olderCv = CoefficientOfVariation(older);
        var recentCv = CoefficientOfVariation(recent);
        return recentCv > olderCv * 2 && olderCv > 0 ? options.MinLookBack : null;
    }

    /// <summary>
    /// Extends in <see cref="ExtensionStep"/> increments when the usable gap count after outlier removal is below
    /// <see cref="PredictionOptions.MinimumBucketSamples"/> but above zero, stopping at
    /// <see cref="PredictionOptions.MaxLookBack"/> or when enough samples are found. Returns <c>null</c> when no
    /// extension is needed.
    /// </summary>
    private static TimeSpan? TryExtend(IReadOnlyList<ObservedEvent> chronological, PredictionContext context, PredictionOptions options)
    {
        var currentCount = CountUsableGaps(chronological, context.Now, options.LookBack, options);
        if (currentCount >= options.MinimumBucketSamples || currentCount == 0)
        {
            return null;
        }

        var maxByAge = context.Now - BirthInstant(context.BirthDate);
        var effectiveMax = maxByAge < options.MaxLookBack ? maxByAge : options.MaxLookBack;
        if (effectiveMax <= options.LookBack)
        {
            return null;
        }

        for (var candidate = options.LookBack + ExtensionStep; candidate <= effectiveMax; candidate += ExtensionStep)
        {
            if (CountUsableGaps(chronological, context.Now, candidate, options) >= options.MinimumBucketSamples)
            {
                return candidate;
            }
        }

        return null;
    }

    /// <summary>Counts start-to-start gaps in the window that survive minimum-length and outlier filters.</summary>
    private static int CountUsableGaps(IReadOnlyList<ObservedEvent> chronological, DateTimeOffset now, TimeSpan lookBack, PredictionOptions options)
    {
        var windowStart = now - lookBack;
        var inWindow = chronological.Where(item => item.StartedAt >= windowStart && item.StartedAt <= now).ToArray();
        if (inWindow.Length < 2)
        {
            return 0;
        }

        var gaps = inWindow
            .Zip(inWindow.Skip(1))
            .Select(pair => pair.Second.StartedAt - pair.First.StartedAt)
            .Where(gap => gap >= options.MinimumSampleLength)
            .ToArray();

        if (gaps.Length == 0)
        {
            return 0;
        }

        var median = Median(gaps);
        var limit = median * options.OutlierFactor;
        return gaps.Count(gap => gap <= limit);
    }

    private static double CoefficientOfVariation(IReadOnlyList<ObservedEvent> chronological)
    {
        if (chronological.Count < 2)
        {
            return 0;
        }

        var gaps = chronological
            .Zip(chronological.Skip(1))
            .Select(pair => (pair.Second.StartedAt - pair.First.StartedAt).TotalMinutes)
            .ToArray();

        if (gaps.Length == 0)
        {
            return 0;
        }

        var mean = gaps.Average();
        if (mean <= 0)
        {
            return 0;
        }

        var variance = gaps.Sum(gap => (gap - mean) * (gap - mean)) / gaps.Length;
        return Math.Sqrt(variance) / mean;
    }

    private static TimeSpan Median(TimeSpan[] sorted)
    {
        Array.Sort(sorted);
        var mid = (sorted.Length - 1) / 2;
        return sorted[mid];
    }

    private static TimeSpan Clamp(TimeSpan value, TimeSpan min, TimeSpan max) =>
        value < min ? min : value > max ? max : value;

    /// <summary>Never returns a look-back that extends before the baby's birth date.</summary>
    private static TimeSpan ClampToAge(TimeSpan value, PredictionContext context)
    {
        var age = context.Now - BirthInstant(context.BirthDate);
        return age < value ? age : value;
    }

    private static DateTimeOffset BirthInstant(DateOnly birthDate) =>
        new(birthDate.Year, birthDate.Month, birthDate.Day, 0, 0, 0, TimeSpan.Zero);
}