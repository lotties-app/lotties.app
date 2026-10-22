using Lotties.Domain.Predictions;

namespace Lotties.Application.Predictions;

/// <summary>
/// The diaper predictions (docs/design/11-patterns.md section 8): the next wet diaper and the next dirty one, each
/// <c>null</c> when its gate did not pass (nothing is guessed). Instants are UTC; lengths whole minutes. Clients build
/// their own text and anchor the windows at their latest local events; there is no prose.
/// </summary>
public sealed class DiaperPredictionsResponse
{
    public DiaperGapResponse? Wet { get; set; }

    public DirtyDiaperResponse? Dirty { get; set; }

    public DiaperRuleResponse Rule { get; set; } = new();

    public static DiaperPredictionsResponse For(DiaperPrediction prediction, DiaperPredictionOptions rules)
    {
        ArgumentNullException.ThrowIfNull(prediction);
        ArgumentNullException.ThrowIfNull(rules);
        return new DiaperPredictionsResponse
        {
            Wet = prediction.Wet is { } wet ? DiaperGapResponse.For(wet, prediction.WetTrend) : null,
            Dirty = prediction.Dirty is { } dirty ? (DirtyDiaperResponse)dirty : null,
            Rule = DiaperRuleResponse.For(rules),
        };
    }
}

/// <summary>The next diaper of one kind from the gaps between them: anchored at the latest one.</summary>
public sealed class DiaperGapResponse
{
    /// <summary>The latest diaper of the kind (UTC).</summary>
    public DateTimeOffset AnchorAt { get; set; }

    /// <summary>Anchor plus the lower, median and upper gap.</summary>
    public NextStartWindowResponse NextStart { get; set; } = new();

    public int LowerGapMinutes { get; set; }

    public int MedianGapMinutes { get; set; }

    public int UpperGapMinutes { get; set; }

    /// <summary>Diapers of the kind in the look-back.</summary>
    public int EventCount { get; set; }

    /// <summary>Gaps the estimate comes from.</summary>
    public int GapCount { get; set; }

    /// <summary><c>Low</c>, <c>Medium</c> or <c>High</c>.</summary>
    public string Confidence { get; set; } = string.Empty;

    /// <summary>Wet diapers only: the last 24 hours against the usual count, or <c>null</c> with too little history.</summary>
    public DiaperTrendResponse? Trend { get; set; }

    public static DiaperGapResponse For(DiaperGapPrediction gap, DiaperTrend? trend = null)
    {
        ArgumentNullException.ThrowIfNull(gap);
        return new DiaperGapResponse
        {
            AnchorAt = gap.AnchorAt.ToUniversalTime(),
            NextStart = new NextStartWindow(gap.Window.Earliest.ToUniversalTime(), gap.Window.Expected.ToUniversalTime(), gap.Window.Latest.ToUniversalTime()),
            LowerGapMinutes = WholeMinutes.Of(gap.LowerGap),
            MedianGapMinutes = WholeMinutes.Of(gap.MedianGap),
            UpperGapMinutes = WholeMinutes.Of(gap.UpperGap),
            EventCount = gap.EventCount,
            GapCount = gap.GapCount,
            Confidence = gap.Confidence.ToString(),
            Trend = trend is null ? null : (DiaperTrendResponse)trend,
        };
    }
}

/// <summary>The dirty diaper signals that passed their gates (at least one) and the latest dirty diaper.</summary>
public sealed class DirtyDiaperResponse
{
    /// <summary>The latest dirty diaper (UTC), or <c>null</c> without one in the look-back.</summary>
    public DateTimeOffset? LastDirtyAt { get; set; }

    /// <summary>From the gaps between dirty diapers, or <c>null</c> when that gate did not pass.</summary>
    public DiaperGapResponse? Gap { get; set; }

    /// <summary>The usual lag after feeds, or <c>null</c> when that gate did not pass.</summary>
    public DiaperFeedLagResponse? AfterFeed { get; set; }

    public static implicit operator DirtyDiaperResponse(DirtyDiaperPrediction dirty)
    {
        ArgumentNullException.ThrowIfNull(dirty);
        return new DirtyDiaperResponse
        {
            LastDirtyAt = dirty.LastDirtyAt?.ToUniversalTime(),
            Gap = dirty.Gap is { } gap ? DiaperGapResponse.For(gap) : null,
            AfterFeed = dirty.AfterFeed is { } lag ? (DiaperFeedLagResponse)lag : null,
        };
    }
}

/// <summary>How long after a feed ends the next dirty diaper usually comes (whole minutes).</summary>
public sealed class DiaperFeedLagResponse
{
    public int LowerLagMinutes { get; set; }

    public int MedianLagMinutes { get; set; }

    public int UpperLagMinutes { get; set; }

    /// <summary>Dirty diapers with a feed in the window before them (the lags used).</summary>
    public int PairCount { get; set; }

    /// <summary><c>Low</c>, <c>Medium</c> or <c>High</c>.</summary>
    public string Confidence { get; set; } = string.Empty;

    /// <summary>The end of the latest finished feed (UTC), or <c>null</c> without one.</summary>
    public DateTimeOffset? LatestFeedEndedAt { get; set; }

    public static implicit operator DiaperFeedLagResponse(DiaperFeedLag lag)
    {
        ArgumentNullException.ThrowIfNull(lag);
        return new DiaperFeedLagResponse
        {
            LowerLagMinutes = WholeMinutes.Of(lag.LowerLag),
            MedianLagMinutes = WholeMinutes.Of(lag.MedianLag),
            UpperLagMinutes = WholeMinutes.Of(lag.UpperLag),
            PairCount = lag.PairCount,
            Confidence = lag.Confidence.ToString(),
            LatestFeedEndedAt = lag.LatestFeedEndedAt?.ToUniversalTime(),
        };
    }
}

/// <summary>Wet diapers in the last 24 hours and the usual count per 24 hours before them (one decimal).</summary>
public sealed class DiaperTrendResponse
{
    public int Last24Hours { get; set; }

    public double UsualPer24Hours { get; set; }

    /// <summary>At most half the usual count (of at least 4): the "Why?" sheet mentions the pediatrician, gently.</summary>
    public bool DroppedSharply { get; set; }

    public static implicit operator DiaperTrendResponse(DiaperTrend trend)
    {
        ArgumentNullException.ThrowIfNull(trend);
        return new DiaperTrendResponse
        {
            Last24Hours = trend.Recent,
            UsualPer24Hours = trend.UsualPerSpan,
            DroppedSharply = trend.DroppedSharply,
        };
    }
}

/// <summary>The rules the diaper predictions were made by, so clients can state them in plain words.</summary>
public sealed class DiaperRuleResponse
{
    public int WetLookBackDays { get; set; }

    public int MinimumWetEvents { get; set; }

    public int DirtyLookBackDays { get; set; }

    public int MinimumDirtyEvents { get; set; }

    /// <summary>The window runs from this percentile of the gaps (25)...</summary>
    public int LowerPercentile { get; set; }

    /// <summary>...to this one (75).</summary>
    public int UpperPercentile { get; set; }

    /// <summary>A feed counts for this long before a dirty diaper.</summary>
    public int FeedWindowMinutes { get; set; }

    public int MinimumFeedPairs { get; set; }

    /// <summary>The lag after feeds is used only when its middle half is at most this wide.</summary>
    public int MaximumLagSpreadMinutes { get; set; }

    /// <summary>The Now card shows from this long before the expected time...</summary>
    public int LeadMinutes { get; set; }

    /// <summary>...until this long after it.</summary>
    public int GraceMinutes { get; set; }

    public static DiaperRuleResponse For(DiaperPredictionOptions rules)
    {
        ArgumentNullException.ThrowIfNull(rules);
        return new DiaperRuleResponse
        {
            WetLookBackDays = WholeDays.Of(rules.WetLookBack),
            MinimumWetEvents = rules.MinimumWetEvents,
            DirtyLookBackDays = WholeDays.Of(rules.DirtyLookBack),
            MinimumDirtyEvents = rules.MinimumDirtyEvents,
            LowerPercentile = Percent(rules.LowerQuantile),
            UpperPercentile = Percent(rules.UpperQuantile),
            FeedWindowMinutes = WholeMinutes.Of(rules.FeedWindow),
            MinimumFeedPairs = rules.MinimumFeedPairs,
            MaximumLagSpreadMinutes = WholeMinutes.Of(rules.MaximumLagSpread),
            LeadMinutes = WholeMinutes.Of(rules.CardLead),
            GraceMinutes = WholeMinutes.Of(rules.CardGrace),
        };
    }

    private static int Percent(double quantile) => (int)Math.Round(quantile * 100, MidpointRounding.AwayFromZero);
}
