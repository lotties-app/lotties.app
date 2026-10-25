namespace Lotties.Domain.CryReasons;

/// <summary>The feeding signals; <see cref="HasFeeds"/> false means nothing was logged.</summary>
/// <param name="HasFeeds">Any feed was logged.</param>
/// <param name="RunningMinutes">Minutes a feeding timer has run, or <c>null</c> when none runs.</param>
/// <param name="SinceLastMinutes">Whole minutes since the start of the latest feed.</param>
/// <param name="RecentGapsMinutes">Her recent start-to-start feed gaps (<see cref="CryFeedGaps.Between"/>).</param>
/// <param name="ServerGapMinutes">The usual gap of the server's feeding prediction (30 min to 12 h), or <c>null</c>.</param>
/// <param name="NormGapMinutes">The published usual gap for her age and milk, or <c>null</c> (the band's default is used).</param>
/// <param name="TopUpShare">The share of her usual gap the next feed comes earlier after a smaller bottle, or <c>null</c>.</param>
/// <param name="SinceLastFeedEndMs">Milliseconds since the latest feed ended, or <c>null</c> without a finished one.</param>
public sealed record CryHungerSignal(
    bool HasFeeds,
    int? RunningMinutes,
    int SinceLastMinutes,
    IReadOnlyList<double> RecentGapsMinutes,
    int? ServerGapMinutes,
    int? NormGapMinutes,
    double? TopUpShare,
    double? SinceLastFeedEndMs);

/// <summary>The awake stretch being judged: its minutes and whether it is in the night.</summary>
public sealed record CryAwakeStretch(int Minutes, bool Night);

/// <summary>The awake stretch (or <c>null</c> when the state is unknown), her usual limit and whether the overtired heads-up is showing.</summary>
public sealed record CrySleepySignal(CryAwakeStretch? Stretch, int? WindowMinutes, bool Overtired);

/// <summary>The server's dirty-diaper estimate that is due now (<c>afterFeed</c> or <c>gap</c>) and its expected time.</summary>
public sealed record CryDirtyDue(string Signal, DateTimeOffset ExpectedAt);

/// <summary>The diaper signals: minutes since the latest diaper (<c>null</c> without one), her usual wet gap and a due dirty diaper.</summary>
public sealed record CryDiaperSignal(int? SinceLastMinutes, int? UsualWetGapMinutes, CryDirtyDue? DirtyDue);

/// <summary>
/// The gas signals: whether any feed was logged, how long ago the latest finished milk feed ended and whether a burp or
/// belly massage was logged since it started, her belly pain and fussy windows she is in now (their usual clock times) and
/// the local hour.
/// </summary>
public sealed record CryGasSignal(bool HasFeeds, double? SinceMilkFeedEndMs, bool ReliefSinceFeed, string? BellyPatternClock, string? FussyPatternClock, int LocalHour);

/// <summary>Everything the ranking reads, already extracted from the log (see <see cref="CryReasonRanker"/>).</summary>
public sealed record CrySignals(CryAgeBand Band, bool Asleep, CryHungerSignal Hunger, CrySleepySignal Sleepy, CryDiaperSignal Diaper, CryGasSignal Gas);
