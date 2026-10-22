namespace Lotties.Domain.Predictions;

/// <summary>
/// When the baby will probably pee and poop (docs/design/11-patterns.md section 8). Pure, deterministic and independent
/// of input order; heuristics only (the backtest in docs/ml/BENCHMARK.md found a learned model only slightly better for
/// diapers, so the heuristic stays). Rules, with <see cref="DiaperPredictionOptions.Default"/>:
/// <list type="number">
/// <item>A wet diaper is a <c>diaper</c> marked <c>WET</c> or <c>MIXED</c>; a dirty one <c>DIRTY</c> or <c>MIXED</c>
/// (<see cref="DiaperContents"/>). Events after now are ignored.</item>
/// <item>Wet: with at least 8 wet diapers in the last 7 days, the gaps between consecutive ones (elapsed time, so
/// daylight saving changes do not matter) lose duplicates (under 1 minute) and outliers (over 3 times the plain median);
/// with at least 3 gaps left the next wet diaper is expected at the latest one plus the recency-weighted median gap,
/// usually between the 25th and 75th percentile gaps (the nap window's calibration).</item>
/// <item>Dirty, gap signal: the same over the last 14 days with at least 5 dirty diapers.</item>
/// <item>Dirty, after-feed signal: for each dirty diaper of the last 14 days, the latest feed that ended (started, for
/// an instant feed; running feeds are skipped) at most 3 hours before it, when that dirty diaper is the first one after
/// the feed. With at least 5 such pairs and the 25th to 75th percentile of the lags at most 40 minutes apart, the next
/// dirty diaper after a feed is expected after the median lag.</item>
/// <item>No signal passing its gate: no estimate (never a guess).</item>
/// <item>Confidence: from the number of gaps (pairs) and how tight the window is (see the options).</item>
/// <item>Wet trend: wet diapers of the last 24 hours against the usual count per 24 hours before them (at least 2 days
/// of history); a sharp drop (at most half of a usual count of at least 4) is noted gently, never as an alarm.</item>
/// </list>
/// </summary>
public static class DiaperPredictions
{
    /// <param name="events">Past events that are not soft deleted, of any type, in any order.</param>
    public static DiaperPrediction Predict(IEnumerable<ObservedEvent> events, DateTimeOffset now, DiaperPredictionOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(events);
        var rules = options ?? DiaperPredictionOptions.Default;
        var past = events.Where(item => item.StartedAt <= now).ToArray();
        var diapers = past.Where(item => item.TypeKey == rules.DiaperTypeKey).ToArray();
        var wet = diapers.Where(item => DiaperContents.IsWet(item.Content)).Select(item => item.StartedAt).Order().ToArray();
        var dirty = diapers.Where(item => DiaperContents.IsDirty(item.Content)).Select(item => item.StartedAt).Order().ToArray();
        var feedEnds = FeedEnds(past, now, rules);
        return new DiaperPrediction(
            GapPrediction(wet, now, rules.WetLookBack, rules.MinimumWetEvents, rules),
            DirtyPrediction(dirty, feedEnds, now, rules),
            WetTrend(wet, now, rules));
    }

    /// <summary>The ends of the finished feeds up to now (an instant feed ends when it starts), oldest first.</summary>
    private static DateTimeOffset[] FeedEnds(IEnumerable<ObservedEvent> past, DateTimeOffset now, DiaperPredictionOptions rules) =>
        past.Where(item => item.TypeKey == rules.FeedTypeKey && item.EndedAt is { } end && end <= now)
            .Select(item => item.EndedAt!.Value)
            .Order()
            .ToArray();

    private static DirtyDiaperPrediction? DirtyPrediction(IReadOnlyList<DateTimeOffset> dirty, IReadOnlyList<DateTimeOffset> feedEnds, DateTimeOffset now, DiaperPredictionOptions rules)
    {
        var gap = GapPrediction(dirty, now, rules.DirtyLookBack, rules.MinimumDirtyEvents, rules);
        var afterFeed = FeedLag(dirty, feedEnds, now, rules);
        return gap is null && afterFeed is null ? null : new DirtyDiaperPrediction(gap, afterFeed, dirty.Count == 0 ? null : dirty[^1]);
    }

    /// <summary>The gap estimate of one kind, or <c>null</c> when its gate does not pass.</summary>
    private static DiaperGapPrediction? GapPrediction(IReadOnlyList<DateTimeOffset> times, DateTimeOffset now, TimeSpan lookBack, int minimumEvents, DiaperPredictionOptions rules)
    {
        var recent = times.Where(time => time >= now - lookBack).ToArray();
        if (recent.Length < minimumEvents)
        {
            return null;
        }

        var gaps = Usable(recent.Zip(recent.Skip(1), (from, to) => new TimedSample(to - from, from)).ToArray(), rules);
        return gaps.Count < rules.MinimumGaps ? null : GapEstimate(recent[^1], recent.Length, gaps, now, rules);
    }

    private static DiaperGapPrediction GapEstimate(DateTimeOffset anchor, int eventCount, IReadOnlyList<TimedSample> gaps, DateTimeOffset now, DiaperPredictionOptions rules)
    {
        var lower = WeightedQuantile(gaps, rules.LowerQuantile, now, rules);
        var median = WeightedQuantile(gaps, 0.5, now, rules);
        var upper = WeightedQuantile(gaps, rules.UpperQuantile, now, rules);
        return new DiaperGapPrediction(anchor, lower, median, upper, eventCount, gaps.Count, GapConfidence(gaps.Count, lower, median, upper, rules));
    }

    private static TimeSpan WeightedQuantile(IReadOnlyList<TimedSample> gaps, double quantile, DateTimeOffset now, DiaperPredictionOptions rules) =>
        WeightedStatistics.RoundToMinute(WeightedStatistics.Quantile(gaps, quantile, now, rules.RecencyHalfLife));

    /// <summary>Drops duplicates (too short), then gaps longer than the outlier factor times the plain median.</summary>
    private static IReadOnlyList<TimedSample> Usable(IReadOnlyList<TimedSample> gaps, DiaperPredictionOptions rules)
    {
        var longEnough = gaps.Where(gap => gap.Length >= rules.MinimumGap).ToArray();
        if (longEnough.Length == 0)
        {
            return longEnough;
        }

        var limit = WeightedStatistics.PlainMedian(longEnough) * rules.OutlierFactor;
        return longEnough.Where(gap => gap.Length <= limit).ToArray();
    }

    private static PredictionConfidence GapConfidence(int gapCount, TimeSpan lower, TimeSpan median, TimeSpan upper, DiaperPredictionOptions rules)
    {
        var spreadRatio = median > TimeSpan.Zero ? (upper - lower) / median : double.MaxValue;
        return (gapCount, spreadRatio) switch
        {
            _ when gapCount >= rules.HighConfidenceGaps && spreadRatio <= rules.HighConfidenceSpreadRatio => PredictionConfidence.High,
            _ when gapCount >= rules.MediumConfidenceGaps && spreadRatio <= rules.MediumConfidenceSpreadRatio => PredictionConfidence.Medium,
            _ => PredictionConfidence.Low,
        };
    }

    /// <summary>The lag after feeds, or <c>null</c> with too few pairs or a spread over the limit.</summary>
    private static DiaperFeedLag? FeedLag(IReadOnlyList<DateTimeOffset> dirty, IReadOnlyList<DateTimeOffset> feedEnds, DateTimeOffset now, DiaperPredictionOptions rules)
    {
        var lags = dirty
            .Select((time, index) => LagBefore(time, index == 0 ? null : dirty[index - 1], feedEnds, rules))
            .Where((lag, index) => lag is not null && dirty[index] >= now - rules.DirtyLookBack)
            .Select(lag => lag!.Value)
            .ToArray();
        if (lags.Length < rules.MinimumFeedPairs)
        {
            return null;
        }

        var lower = Quantile(lags, rules.LowerQuantile);
        var upper = Quantile(lags, rules.UpperQuantile);
        return upper - lower > rules.MaximumLagSpread
            ? null
            : new DiaperFeedLag(lower, Quantile(lags, 0.5), upper, lags.Length, LagConfidence(lags.Length, upper - lower, rules), feedEnds.Count == 0 ? null : feedEnds[^1], rules.FeedWindow);
    }

    /// <summary>
    /// The lag from the latest feed end at most the feed window before <paramref name="dirtyAt"/>, when no other dirty
    /// diaper came between that feed and it (<paramref name="previousDirtyAt"/>); otherwise <c>null</c>.
    /// </summary>
    private static TimeSpan? LagBefore(DateTimeOffset dirtyAt, DateTimeOffset? previousDirtyAt, IReadOnlyList<DateTimeOffset> feedEnds, DiaperPredictionOptions rules)
    {
        var feedEnd = feedEnds.Where(end => end <= dirtyAt).Select(end => (DateTimeOffset?)end).LastOrDefault();
        var follows = feedEnd is { } end && dirtyAt - end <= rules.FeedWindow && !(previousDirtyAt >= end);
        return follows ? dirtyAt - feedEnd!.Value : null;
    }

    private static TimeSpan Quantile(IReadOnlyList<TimeSpan> values, double quantile) =>
        WeightedStatistics.RoundToMinute(WeightedStatistics.InterpolatedQuantile(values, quantile));

    private static PredictionConfidence LagConfidence(int pairCount, TimeSpan spread, DiaperPredictionOptions rules) => pairCount switch
    {
        _ when pairCount >= rules.HighConfidencePairs && spread <= rules.HighConfidenceLagSpread => PredictionConfidence.High,
        _ when pairCount >= rules.MediumConfidencePairs && spread <= rules.MediumConfidenceLagSpread => PredictionConfidence.Medium,
        _ => PredictionConfidence.Low,
    };

    /// <summary>Wet diapers in the recent span against the usual count per span before it; <c>null</c> with too little history.</summary>
    private static DiaperTrend? WetTrend(IReadOnlyList<DateTimeOffset> wet, DateTimeOffset now, DiaperPredictionOptions rules)
    {
        var recentFrom = now - rules.RecentSpan;
        var earlier = wet.Where(time => time >= now - rules.WetLookBack && time < recentFrom).ToArray();
        var history = earlier.Length == 0 ? TimeSpan.Zero : recentFrom - earlier[0];
        if (history < rules.MinimumHistoryForDrop)
        {
            return null;
        }

        var recent = wet.Count(time => time >= recentFrom);
        var usual = Math.Round(earlier.Length / (history / rules.RecentSpan), 1, MidpointRounding.AwayFromZero);
        return new DiaperTrend(recent, usual, usual >= rules.MinimumUsualForDrop && recent <= usual * rules.SharpDropRatio);
    }
}
