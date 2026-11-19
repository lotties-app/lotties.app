namespace Lotties.Domain.Predictions;

/// <summary>Tuning constants for the cry-cause classifier (<see cref="CryCauseClassifier"/>).</summary>
public sealed record CryCauseOptions
{
    public static CryCauseOptions Default { get; } = new();

    /// <summary>Earliest time after a feeding when gas discomfort is considered plausible.</summary>
    public TimeSpan GasPostFeedWindowMin { get; init; } = TimeSpan.FromMinutes(15);

    /// <summary>Latest time after a feeding when gas discomfort is still considered plausible.</summary>
    public TimeSpan GasPostFeedWindowMax { get; init; } = TimeSpan.FromMinutes(45);

    /// <summary>Multiplier applied to bottle feedings' gas score (air intake makes gas more likely).</summary>
    public double BottleGasMultiplier { get; init; } = 1.5;

    /// <summary>Percentile of historical awake windows above which overtiredness is scored.</summary>
    public double AwakeWindowExceedPercentile { get; init; } = 0.75;

    /// <summary>Multiplier on the typical dirty-diaper interval before pre-poop discomfort is scored.</summary>
    public double PoopIntervalMultiplier { get; init; } = 1.5;

    /// <summary>Fewest events in the overstimulation window to trigger an overstimulation score.</summary>
    public int OverstimulationEventThreshold { get; init; } = 6;

    /// <summary>How far back event density is measured for overstimulation scoring.</summary>
    public TimeSpan OverstimulationWindow { get; init; } = TimeSpan.FromHours(2);

    /// <summary>Local hour (inclusive) at which evening phase begins for overstimulation scoring.</summary>
    public int OverstimulationEveningHour { get; init; } = 17;

    /// <summary>Minimum raw score a cause must reach to appear in the output (below this, probability goes to Unknown).</summary>
    public double MinimumScoreThreshold { get; init; } = 0.1;

    /// <summary>Default hungry gap: when no feeding prediction exists, this gap triggers hunger scoring.</summary>
    public TimeSpan DefaultHungerGap { get; init; } = TimeSpan.FromHours(3);

    /// <summary>Default awake window for overtired scoring when no sleep prediction exists.</summary>
    public TimeSpan DefaultAwakeWindow { get; init; } = TimeSpan.FromHours(2);

    /// <summary>Default dirty-diaper interval for pre-poop scoring when no diaper pattern exists.</summary>
    public TimeSpan DefaultDirtyDiaperInterval { get; init; } = TimeSpan.FromHours(6);
}