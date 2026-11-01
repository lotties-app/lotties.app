using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Predictions;

/// <summary>Tuning constants of the heuristic v1 predictions engine. <see cref="Default"/> holds the shipped values.</summary>
public sealed record PredictionOptions
{
    public static PredictionOptions Default { get; } = new();

    /// <summary>How far back events are considered.</summary>
    public TimeSpan LookBack { get; init; } = TimeSpan.FromDays(14);

    /// <summary>A sample this old weighs half as much as one from now (exponential recency weighting).</summary>
    public TimeSpan RecencyHalfLife { get; init; } = TimeSpan.FromDays(4);

    /// <summary>Fewest intervals (or durations) needed to predict anything.</summary>
    public int MinimumSamples { get; init; } = 3;

    /// <summary>Fewest samples an age band or a day/night phase needs before it is used instead of all data.</summary>
    public int MinimumBucketSamples { get; init; } = 5;

    /// <summary>Sample count from which confidence is Medium.</summary>
    public int MediumConfidenceSamples { get; init; } = 10;

    /// <summary>Sample count from which confidence is High.</summary>
    public int HighConfidenceSamples { get; init; } = 30;

    /// <summary>Intervals and durations shorter than this are ignored (duplicates, instant events, accidental taps).</summary>
    public TimeSpan MinimumSampleLength { get; init; } = TimeSpan.FromMinutes(1);

    /// <summary>Samples longer than this multiple of the plain median are outliers (logging gaps, forgotten timers).</summary>
    public double OutlierFactor { get; init; } = 3.0;

    /// <summary>Quantile of the intervals that gives the earliest expected next start.</summary>
    public double WindowLowerQuantile { get; init; } = 0.25;

    /// <summary>Quantile of the intervals that gives the latest expected next start.</summary>
    public double WindowUpperQuantile { get; init; } = 0.75;

    /// <summary>Local time when night starts (inclusive).</summary>
    public TimeOnly NightStartsAt { get; init; } = new(19, 0);

    /// <summary>Local time when night ends (exclusive).</summary>
    public TimeOnly NightEndsAt { get; init; } = new(7, 0);

    /// <summary>Types whose day and night rhythms differ enough to be measured separately.</summary>
    public IReadOnlySet<EventTypeKey> DayNightTypeKeys { get; init; } = new HashSet<EventTypeKey>
    {
        BuiltInEventTypes.Feeding.Key,
        BuiltInEventTypes.Sleep.Key,
    };

    /// <summary>
    /// The type predicted from the last wake time plus the awake window instead of start-to-start intervals. Its
    /// events are turned into sleep sessions by their payload <c>kind</c> first (see <see cref="SleepSessions"/>).
    /// </summary>
    public EventTypeKey AwakeWindowTypeKey { get; init; } = BuiltInEventTypes.Sleep.Key;

    /// <summary>Longest night built from a <c>bed_time</c> marker to the next <c>woke_up</c>; longer pairs are ignored.</summary>
    public TimeSpan MaxNightSessionLength { get; init; } = TimeSpan.FromHours(16);
}
