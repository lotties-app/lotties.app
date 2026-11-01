using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>
/// The rules of <see cref="DiaperPredictions"/> (docs/design/11-patterns.md section 8). <see cref="Default"/> holds the
/// shipped values; other instances exist for tests.
/// </summary>
public sealed record DiaperPredictionOptions
{
    public static DiaperPredictionOptions Default { get; } = new();

    public EventTypeKey DiaperTypeKey { get; init; } = BuiltInEventTypes.Diaper.Key;

    public EventTypeKey FeedTypeKey { get; init; } = BuiltInEventTypes.Feeding.Key;

    /// <summary>Wet diapers started this long before now or later are used.</summary>
    public TimeSpan WetLookBack { get; init; } = TimeSpan.FromDays(7);

    /// <summary>Fewest wet diapers in <see cref="WetLookBack"/>; with fewer there is no wet estimate (no guess).</summary>
    public int MinimumWetEvents { get; init; } = 8;

    /// <summary>Dirty diapers started this long before now or later are used (gaps and the lag after feeds).</summary>
    public TimeSpan DirtyLookBack { get; init; } = TimeSpan.FromDays(14);

    /// <summary>Fewest dirty diapers in <see cref="DirtyLookBack"/> for the gap estimate.</summary>
    public int MinimumDirtyEvents { get; init; } = 5;

    /// <summary>Fewest usable gaps (after the drops below) an estimate needs, as the predictions engine.</summary>
    public int MinimumGaps { get; init; } = 3;

    /// <summary>Gaps shorter than this are ignored (the same change logged twice).</summary>
    public TimeSpan MinimumGap { get; init; } = TimeSpan.FromMinutes(1);

    /// <summary>Gaps longer than this multiple of the plain median are ignored (changes that were not logged).</summary>
    public double OutlierFactor { get; init; } = 3.0;

    /// <summary>The window runs from this quantile of the gaps...</summary>
    public double LowerQuantile { get; init; } = 0.25;

    /// <summary>...to this one (the middle half, as the nap window).</summary>
    public double UpperQuantile { get; init; } = 0.75;

    /// <summary>A gap this old weighs half as much as a current one (as the predictions engine).</summary>
    public TimeSpan RecencyHalfLife { get; init; } = PredictionOptions.Default.RecencyHalfLife;

    /// <summary>A feed that ended at most this long before a dirty diaper (the next one after it) explains it.</summary>
    public TimeSpan FeedWindow { get; init; } = TimeSpan.FromHours(3);

    /// <summary>Fewest dirty diapers with a feed in <see cref="FeedWindow"/> before them for the lag after feeds.</summary>
    public int MinimumFeedPairs { get; init; } = 5;

    /// <summary>The lag after feeds is used only when its middle half is at most this wide (25th to 75th percentile).</summary>
    public TimeSpan MaximumLagSpread { get; init; } = TimeSpan.FromMinutes(40);

    /// <summary>Gap estimates: high confidence from this many gaps (with a tight spread, below)...</summary>
    public int HighConfidenceGaps { get; init; } = 20;

    /// <summary>...medium from this many.</summary>
    public int MediumConfidenceGaps { get; init; } = 10;

    /// <summary>High confidence needs the window (upper - lower gap) at most this share of the median gap...</summary>
    public double HighConfidenceSpreadRatio { get; init; } = 0.5;

    /// <summary>...medium at most this share.</summary>
    public double MediumConfidenceSpreadRatio { get; init; } = 1.0;

    /// <summary>Lag after feeds: high confidence from this many pairs (with a lag spread up to <see cref="HighConfidenceLagSpread"/>)...</summary>
    public int HighConfidencePairs { get; init; } = 15;

    /// <summary>...medium from this many (spread up to <see cref="MediumConfidenceLagSpread"/>).</summary>
    public int MediumConfidencePairs { get; init; } = 8;

    public TimeSpan HighConfidenceLagSpread { get; init; } = TimeSpan.FromMinutes(20);

    public TimeSpan MediumConfidenceLagSpread { get; init; } = TimeSpan.FromMinutes(30);

    /// <summary>Recent wet diapers are counted over this span to notice a sharp drop.</summary>
    public TimeSpan RecentSpan { get; init; } = TimeSpan.FromHours(24);

    /// <summary>A drop is sharp when the recent count is at most this share of the usual count per span...</summary>
    public double SharpDropRatio { get; init; } = 0.5;

    /// <summary>...and the usual count per span is at least this many.</summary>
    public double MinimumUsualForDrop { get; init; } = 4;

    /// <summary>The usual count needs at least this much history before the recent span.</summary>
    public TimeSpan MinimumHistoryForDrop { get; init; } = TimeSpan.FromDays(2);

    /// <summary>The Now card shows from this long before the expected time...</summary>
    public TimeSpan CardLead { get; init; } = TimeSpan.FromMinutes(20);

    /// <summary>...until this long after it.</summary>
    public TimeSpan CardGrace { get; init; } = TimeSpan.FromMinutes(40);
}
