using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>Tuning constants of the heuristic predictions engine (v1.1). <see cref="Default"/> holds the shipped values.</summary>
public sealed record PredictionOptions
{
    public static PredictionOptions Default { get; } = new();

    /// <summary>How far back events are considered (default when adaptation is disabled or has no reason to change).</summary>
    public TimeSpan LookBack { get; init; } = TimeSpan.FromDays(14);

    /// <summary>Shortest look-back the adaptive window may shrink to (regime-change signal).</summary>
    public TimeSpan MinLookBack { get; init; } = TimeSpan.FromDays(7);

    /// <summary>Longest look-back the adaptive window may extend to (sparse-logger signal).</summary>
    public TimeSpan MaxLookBack { get; init; } = TimeSpan.FromDays(28);

    /// <summary>Whether <see cref="AdaptiveLookBack"/> adjusts the window per type based on sample density and variance.</summary>
    public bool LookBackAdaptationEnabled { get; init; } = false;

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

    /// <summary>How many of the most recent bed times (one per evening) the bed-time window is computed from.</summary>
    public int BedTimeSampleCount { get; init; } = 14;

    /// <summary>Fewest bed times in the look-back window needed to predict the next one.</summary>
    public int MinimumBedTimeSamples { get; init; } = 5;

    /// <summary>
    /// Local time when a new evening begins: a bed time between midnight and this time belongs to the previous evening
    /// (a 00:30 bed time is a late one, not an early one).
    /// </summary>
    public TimeOnly EveningDayStartsAt { get; init; } = new(4, 0);

    /// <summary>Whether community-derived static priors may supplement published norms during cold start.</summary>
    public bool UseCommunityStaticPriors { get; init; } = true;

    /// <summary>Whether live community statistics may supplement static priors during cold start (Phase 1 kill switch).</summary>
    public bool UseCommunityLivePriors { get; init; } = false;

    /// <summary>Maximum age of a community statistics release before it is considered stale and ignored.</summary>
    public TimeSpan MaxCommunityPriorAge { get; init; } = TimeSpan.FromDays(14);

    /// <summary>Event types eligible for cold-start predictions. Defaults to feeding only.</summary>
    public IReadOnlySet<EventTypeKey> ColdStartTypeKeys { get; init; } = new HashSet<EventTypeKey>
    {
        BuiltInEventTypes.Feeding.Key,
    };

    /// <summary>Kill switch for Bayesian prior blending. When false, TypePredictor uses pure personal data or pure cold-start priors.</summary>
    public bool BlendingEnabled { get; init; } = false;

    /// <summary>EMA smoothing factor for the blended weight to prevent oscillation near adaptive look-back regime boundaries.</summary>
    public double BlendingEmaAlpha { get; init; } = 0.3;

    /// <summary>Below this effective personal sample count, the prior alone drives the prediction (weight = 1).</summary>
    public int BlendingMinPersonalSamples { get; init; } = 5;

    /// <summary>Above this effective personal sample count, personal data alone drives the prediction (weight = 0).</summary>
    public int BlendingMaxPersonalSamples { get; init; } = 30;

    /// <summary>Kill switch for prediction accuracy tracking. When false, outcomes are not recorded.</summary>
    public bool AccuracyTrackingEnabled { get; init; } = false;

    /// <summary>
    /// Maximum number of unresolved prediction outcomes kept per baby per event type; older ones are expired (closed without a
    /// measurement, never counted in an accuracy average).
    /// </summary>
    public int MaxPendingOutcomes { get; init; } = 50;

    /// <summary>
    /// Days a resolved or expired prediction outcome is kept (counted from when it was predicted), applied for a baby and type
    /// each time a new outcome is recorded for them. <c>0</c> (the default) keeps them until the baby is erased, as the
    /// privacy policy says; a positive value is a retention the policy must state before it is turned on.
    /// </summary>
    public int OutcomeRetentionDays { get; init; } = 0;

    /// <summary>Kill switch for prediction intervals. When true, TypePredictor computes P10-P90 intervals alongside point estimates.</summary>
    public bool UsePredictionIntervals { get; init; } = false;

    /// <summary>Kill switch for cry-cause classification. When false, the classifier is not invoked.</summary>
    public bool CryCauseClassificationEnabled { get; init; } = false;
}
