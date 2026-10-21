namespace BabyRoutine.Domain.Predictions;

/// <summary>
/// Heuristic v1.1 bed-time prediction (the benchmark's "recent bed-time clocks", docs/ml/BENCHMARK.md):
/// <list type="bullet">
/// <item>bed times are the starts of night sessions (<see cref="SleepSessions"/>: <c>bed_time</c> nights and logged
/// <c>night</c> timers), one per evening (the earliest; see <see cref="EveningClock"/>), the most recent
/// <see cref="PredictionOptions.BedTimeSampleCount"/> in the look-back window;</item>
/// <item>there is none while a night is in progress or once tonight's bed time is logged, and none with fewer than
/// <see cref="PredictionOptions.MinimumBedTimeSamples"/> bed times;</item>
/// <item>only the clocks later than now's clock are kept (the bed time has not happened yet tonight); none is
/// predicted when no clock is later;</item>
/// <item>the window is the q25, median and q75 of those clocks (unweighted, linearly interpolated), placed on the
/// current evening and rounded to the minute;</item>
/// <item>the expected duration is the typical night, from finished night sessions only.</item>
/// </list>
/// </summary>
internal static class BedTimePredictor
{
    private const double MedianQuantile = 0.5;

    /// <param name="sleepSessions">Sessions of the sleep type in the look-back window, in any order.</param>
    public static BedTimePrediction? Predict(IReadOnlyList<ObservedEvent> sleepSessions, PredictionContext context, PredictionOptions options)
    {
        var clock = new EveningClock(context.LocalOffset, options.EveningDayStartsAt);
        var nights = sleepSessions.Where(IsNight).ToArray();
        if (IsTonightStarted(nights, clock, context.Now))
        {
            return null;
        }

        var bedTimes = RecentBedTimes(nights, clock, options);
        if (bedTimes.Count < options.MinimumBedTimeSamples)
        {
            return null;
        }

        var nowClock = clock.ClockOf(context.Now);
        var later = bedTimes.Select(clock.ClockOf).Where(value => value > nowClock).ToArray();
        return later.Length == 0 ? null : Build(later, bedTimes.Count, sleepSessions, clock, context, options);
    }

    private static bool IsNight(ObservedEvent session) => SleepSessionKinds.Of(session) == SleepSessionKind.Night;

    private static bool IsTonightStarted(IReadOnlyList<ObservedEvent> nights, EveningClock clock, DateTimeOffset now) =>
        nights.Any(night => night.EndedAt is null || clock.EveningOf(night.StartedAt) == clock.EveningOf(now));

    private static IReadOnlyList<DateTimeOffset> RecentBedTimes(IReadOnlyList<ObservedEvent> nights, EveningClock clock, PredictionOptions options) =>
        nights
            .GroupBy(night => clock.EveningOf(night.StartedAt))
            .Select(evening => evening.Min(night => night.StartedAt))
            .Order()
            .TakeLast(options.BedTimeSampleCount)
            .ToArray();

    private static BedTimePrediction Build(
        IReadOnlyList<TimeSpan> clocks,
        int recentBedTimeCount,
        IReadOnlyList<ObservedEvent> sleepSessions,
        EveningClock clock,
        PredictionContext context,
        PredictionOptions options)
    {
        var evening = clock.EveningOf(context.Now);
        var window = new NextStartWindow(
            StartAt(clocks, options.WindowLowerQuantile, evening, clock),
            StartAt(clocks, MedianQuantile, evening, clock),
            StartAt(clocks, options.WindowUpperQuantile, evening, clock));
        var duration = TypicalNight(sleepSessions, window.Expected, context, options);
        var medianClock = TimeOnly.FromTimeSpan(window.Expected.ToOffset(context.LocalOffset).TimeOfDay);
        var reason = new BedTimeReason(medianClock, clocks.Count, recentBedTimeCount, options.LookBack, duration);
        return new BedTimePrediction(
            options.AwakeWindowTypeKey,
            window,
            duration,
            PredictionConfidences.For(clocks.Count, options),
            clocks.Count,
            reason);
    }

    private static DateTimeOffset StartAt(IReadOnlyList<TimeSpan> clocks, double quantile, DateOnly evening, EveningClock clock) =>
        clock.At(evening, WeightedStatistics.RoundToMinute(WeightedStatistics.InterpolatedQuantile(clocks, quantile))).ToUniversalTime();

    private static DurationEstimate? TypicalNight(IReadOnlyList<ObservedEvent> sleepSessions, DateTimeOffset start, PredictionContext context, PredictionOptions options)
    {
        var selector = new SampleSelector(context, options, options.DayNightTypeKeys.Contains(options.AwakeWindowTypeKey));
        return new DurationEstimator(sleepSessions, selector, context, options).Estimate(start, SleepSessionKind.Night);
    }
}
