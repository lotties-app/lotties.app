namespace Lotties.Domain.Predictions;

/// <summary>
/// The next wet or dirty diaper from the gaps between them (<see cref="DiaperPredictions"/>): anchored at the latest one,
/// expected after the recency-weighted median gap, usually between the lower and upper quantile gaps (the middle half,
/// as the nap window). Gaps are elapsed time, so a daylight saving change never stretches or shrinks one.
/// </summary>
/// <param name="AnchorAt">The latest wet (or dirty) diaper.</param>
/// <param name="EventCount">Diapers of the kind in the look-back.</param>
/// <param name="GapCount">Gaps the estimate comes from (after dropping duplicates and outliers).</param>
public sealed record DiaperGapPrediction(
    DateTimeOffset AnchorAt,
    TimeSpan LowerGap,
    TimeSpan MedianGap,
    TimeSpan UpperGap,
    int EventCount,
    int GapCount,
    PredictionConfidence Confidence)
{
    public NextStartWindow Window => new(AnchorAt + LowerGap, AnchorAt + MedianGap, AnchorAt + UpperGap);
}

/// <summary>
/// How long after a feed ends (its start for an instant feed) the next dirty diaper usually comes, learned from the
/// baby's own log: only from dirty diapers with a feed that ended at most <see cref="Horizon"/> before them, and only
/// when the middle half of the lags is tight (see <see cref="DiaperPredictionOptions.MaximumLagSpread"/>).
/// </summary>
/// <param name="PairCount">Dirty diapers with a feed in the horizon before them (the lags used).</param>
/// <param name="LatestFeedEndedAt">The end of the latest finished feed up to now, or <c>null</c> without one.</param>
/// <param name="Horizon">A feed counts for this long after it ended.</param>
public sealed record DiaperFeedLag(
    TimeSpan LowerLag,
    TimeSpan MedianLag,
    TimeSpan UpperLag,
    int PairCount,
    PredictionConfidence Confidence,
    DateTimeOffset? LatestFeedEndedAt,
    TimeSpan Horizon)
{
    /// <summary>The width of the middle half of the lags.</summary>
    public TimeSpan Spread => UpperLag - LowerLag;

    /// <summary>When the dirty diaper is expected after a feed that ended at <paramref name="feedEndedAt"/>.</summary>
    public NextStartWindow WindowAfter(DateTimeOffset feedEndedAt) =>
        new(feedEndedAt + LowerLag, feedEndedAt + MedianLag, feedEndedAt + UpperLag);
}

/// <summary>The dirty diaper signals that passed their gates (at least one) and the latest dirty diaper.</summary>
public sealed record DirtyDiaperPrediction(DiaperGapPrediction? Gap, DiaperFeedLag? AfterFeed, DateTimeOffset? LastDirtyAt);

/// <summary>
/// Whether wet diapers dropped sharply: <see cref="Recent"/> in the last 24 hours against the usual count per 24 hours
/// before them. Only for the gentle note in the "Why?" sheet (mention it to the pediatrician); never an alarm.
/// </summary>
public sealed record DiaperTrend(int Recent, double UsualPerSpan, bool DroppedSharply);

/// <summary>Which signal an expected diaper comes from.</summary>
public enum DiaperSignal
{
    /// <summary>The gaps between wet diapers.</summary>
    WetGap,

    /// <summary>The gaps between dirty diapers.</summary>
    DirtyGap,

    /// <summary>The usual lag between the end of a feed and the next dirty diaper.</summary>
    DirtyAfterFeed,
}

/// <summary>The diaper a heads-up points at: the signal, the instant it is anchored at (one heads-up per anchor) and the window.</summary>
public sealed record DiaperExpectation(DiaperSignal Signal, DateTimeOffset AnchorAt, NextStartWindow Window);

/// <summary>
/// The diaper predictions of a baby (docs/design/11-patterns.md section 8): the next wet diaper, the next dirty one, and
/// the wet trend. Each part is <c>null</c> when its gate did not pass: nothing is guessed.
/// </summary>
public sealed record DiaperPrediction(DiaperGapPrediction? Wet, DirtyDiaperPrediction? Dirty, DiaperTrend? WetTrend)
{
    public static DiaperPrediction None { get; } = new(null, null, null);

    /// <summary>The next wet diaper (anchored at the latest one, so a new wet diaper is a new expectation).</summary>
    public DiaperExpectation? WetExpectation() =>
        Wet is { } wet ? new DiaperExpectation(DiaperSignal.WetGap, wet.AnchorAt, wet.Window) : null;

    /// <summary>
    /// The next dirty diaper at <paramref name="now"/>: after the latest feed when the lag after feeds passed its gate,
    /// that feed ended at most the horizon before now and no dirty diaper came since it ended; otherwise from the gaps
    /// between dirty diapers (anchored at the latest one), when that gate passed.
    /// </summary>
    public DiaperExpectation? DirtyExpectation(DateTimeOffset now) =>
        AfterFeedExpectation(now) ?? DirtyGapExpectation();

    private DiaperExpectation? AfterFeedExpectation(DateTimeOffset now) =>
        Dirty is { AfterFeed: { LatestFeedEndedAt: { } feedEnd } lag } dirty
        && now - feedEnd <= lag.Horizon
        && !(dirty.LastDirtyAt >= feedEnd)
            ? new DiaperExpectation(DiaperSignal.DirtyAfterFeed, feedEnd, lag.WindowAfter(feedEnd))
            : null;

    private DiaperExpectation? DirtyGapExpectation() =>
        Dirty?.Gap is { } gap ? new DiaperExpectation(DiaperSignal.DirtyGap, gap.AnchorAt, gap.Window) : null;
}
