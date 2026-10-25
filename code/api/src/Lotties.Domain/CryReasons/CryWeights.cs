namespace Lotties.Domain.CryReasons;

/// <summary>Score with no signal, the score at and past <see cref="RampTo"/>, and the ratio (elapsed / usual) range of the rise.</summary>
public sealed record CryRamp(double Floor, double Max, double RampFrom, double RampTo);

/// <summary>The gas weights of one band.</summary>
public sealed record CryGasWeights(double Base, double PostFeed, double PostFeedRelieved, double BellyPattern, double EveningPattern, double EveningGeneric, double Max);

/// <summary>The weights of one age band (the web's <c>CryBandWeights</c>).</summary>
public sealed record CryBandWeights(
    int FeedGapMinutes,
    int WakeWindowMinutes,
    int DiaperGapMinutes,
    CryRamp Hunger,
    CryRamp Sleepy,
    double OvertiredBoost,
    double NightFloor,
    CryRamp Diaper,
    double DirtyDueBoost,
    double StaleFloor,
    CryGasWeights Gas,
    double Comfort);

/// <summary>
/// The generic weights, copied from the web's <c>CRY_WEIGHTS</c> (<c>code/web/src/now/cryReasons.ts</c>); the shared vectors
/// (<c>cryReasonsVectors.json</c>) fail when the two drift. Every number is a conservative everyday default, not a clinical
/// threshold (docs/design/27-cry-reasons.md).
/// </summary>
public sealed record CryWeights
{
    private static readonly CryRamp SleepyRamp = new(0.05, 0.85, 0.6, 1.0);
    private static readonly CryRamp DiaperRamp = new(0.05, 0.75, 0.7, 1.5);
    private static readonly CryGasWeights EarlyGas = new(0.15, 0.4, 0.1, 0.3, 0.15, 0.1, 0.9);

    private static readonly CryBandWeights Newborn = new(150, 60, 120, new(0.1, 0.9, 0.4, 1.0), SleepyRamp, 0.1, 0.45, DiaperRamp, 0.3, 0.6, EarlyGas, 0.3);
    private static readonly CryBandWeights Weeks6To3Months = new(180, 90, 150, new(0.05, 0.9, 0.5, 1.1), SleepyRamp, 0.1, 0.45, DiaperRamp, 0.3, 0.6, EarlyGas, 0.3);
    private static readonly CryBandWeights Months3To6 = new(210, 120, 180, new(0.05, 0.9, 0.55, 1.1), SleepyRamp, 0.1, 0.45, DiaperRamp, 0.3, 0.6, new(0.1, 0.35, 0.1, 0.3, 0.15, 0, 0.9), 0.3);
    private static readonly CryBandWeights Months6Plus = new(240, 180, 210, new(0.05, 0.9, 0.6, 1.2), SleepyRamp, 0.1, 0.45, DiaperRamp, 0.3, 0.6, new(0.1, 0.3, 0.05, 0.3, 0.15, 0, 0.9), 0.3);

    public static CryWeights Default { get; } = new();

    public double LikelyFrom { get; init; } = 0.6;

    public double PossibleFrom { get; init; } = 0.3;

    /// <summary>Score of a cause with nothing logged for it (a neutral <c>possible</c>).</summary>
    public double NoDataScore { get; init; } = 0.4;

    /// <summary>A feed ended this recently: hunger is capped at <see cref="FreshCap"/>.</summary>
    public int FreshFeedMinutes { get; init; } = 15;

    /// <summary>A diaper was logged this recently: diaper is capped at <see cref="FreshCap"/>.</summary>
    public int FreshDiaperMinutes { get; init; } = 20;

    public double FreshCap { get; init; } = 0.1;

    /// <summary>Score of hunger while a feeding timer runs.</summary>
    public double RunningFeedScore { get; init; } = 0.05;

    /// <summary>Gas rises this long after a milk feed ended.</summary>
    public int PostFeedMinutes { get; init; } = 30;

    /// <summary>No diaper for this long: diaper gets at least the band's stale floor.</summary>
    public int StaleDiaperHours { get; init; } = 4;

    /// <summary>Generic evening, local hours (end exclusive).</summary>
    public int EveningFromHour { get; init; } = 17;

    public int EveningUntilHour { get; init; } = 23;

    /// <summary>Her own feed gap: feed starts of the last hours, merged within minutes, gaps up to minutes, at least this many gaps.</summary>
    public int FeedHistoryHours { get; init; } = 72;

    public int FeedMergeMinutes { get; init; } = 30;

    public int FeedGapMaxMinutes { get; init; } = 8 * 60;

    public int MinimumFeedGaps { get; init; } = 4;

    public CryBandWeights For(CryAgeBand band) => band switch
    {
        CryAgeBand.Newborn => Newborn,
        CryAgeBand.Weeks6to3m => Weeks6To3Months,
        CryAgeBand.Months3to6 => Months3To6,
        _ => Months6Plus,
    };
}
