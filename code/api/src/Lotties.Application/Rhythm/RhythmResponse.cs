using System.Globalization;
using Lotties.Domain.Patterns;
using Lotties.Domain.Rhythm;

namespace Lotties.Application.Rhythm;

/// <summary>
/// The wire shape of <c>GET /babies/{id}/rhythm</c> (docs/design/48-baby-rhythm.md section 6). Numbers and statuses only,
/// no prose: clients build their own text. Clocks are local <c>HH:mm</c>, dates <c>yyyy-MM-dd</c>, lengths whole minutes,
/// counts per day rounded to 1 decimal. A value is <c>null</c> unless its <c>status</c> is <c>ok</c>.
/// </summary>
public sealed class RhythmResponse
{
    public Guid BabyId { get; set; }

    public DateTimeOffset GeneratedAt { get; set; }

    /// <summary>The IANA zone local times are in, or <c>null</c> when the fixed <c>utcOffsetMinutes</c> was used.</summary>
    public string? TimeZone { get; set; }

    /// <summary>The first local day of the window (<c>yyyy-MM-dd</c>).</summary>
    public string FirstDay { get; set; } = string.Empty;

    /// <summary>The last local day of the window (yesterday).</summary>
    public string LastDay { get; set; } = string.Empty;

    /// <summary>The number of counted nights.</summary>
    public int Nights { get; set; }

    public RhythmClockResponse BedTime { get; set; } = new();

    public RhythmClockResponse WakeUp { get; set; } = new();

    public RhythmDurationResponse NightLength { get; set; } = new();

    public RhythmDurationResponse LongestStretch { get; set; } = new();

    /// <summary>Bed time to the first logged waking (or to the wake-up without one).</summary>
    public RhythmDurationResponse FirstStretch { get; set; } = new();

    public RhythmNapsResponse Naps { get; set; } = new();

    public RhythmFeedsResponse Feeds { get; set; } = new();

    /// <summary>Always <c>evening_feeds</c> then <c>dirty_diaper_day</c>.</summary>
    public IReadOnlyList<RhythmAssociationResponse> Associations { get; set; } = [];

    public RhythmRuleResponse Rule { get; set; } = new();

    public static RhythmResponse Create(Guid babyId, DateTimeOffset now, LocalClock clock, RhythmMeasurement rhythm, RhythmOptions rules)
    {
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(rhythm);
        ArgumentNullException.ThrowIfNull(rules);
        return new RhythmResponse
        {
            BabyId = babyId,
            GeneratedAt = now.ToUniversalTime(),
            TimeZone = clock.TimeZoneId,
            FirstDay = RhythmWire.Date(rhythm.FirstDay),
            LastDay = RhythmWire.Date(rhythm.LastDay),
            Nights = rhythm.Nights.Count,
            BedTime = rhythm.BedTime,
            WakeUp = rhythm.WakeUp,
            NightLength = rhythm.NightLength,
            LongestStretch = rhythm.LongestStretch,
            FirstStretch = rhythm.FirstStretch,
            Naps = rhythm.Naps,
            Feeds = rhythm.Feeds,
            Associations = rhythm.Associations.Select(association => (RhythmAssociationResponse)association).ToArray(),
            Rule = RhythmRuleResponse.For(rules),
        };
    }
}

/// <summary>A usual clock time: <c>status</c> <c>ok</c>, <c>varies</c> (spread over the limit, no usual time) or <c>not_enough_data</c>.</summary>
public sealed class RhythmClockResponse
{
    public string Status { get; set; } = string.Empty;

    /// <summary>Local <c>HH:mm</c> (circular mean), only when ok.</summary>
    public string? Usual { get; set; }

    /// <summary>Circular standard deviation in whole minutes, with ok and varies (<c>null</c> when the times cancel out).</summary>
    public int? SpreadMinutes { get; set; }

    public int Nights { get; set; }

    public static implicit operator RhythmClockResponse(ClockSummary summary)
    {
        ArgumentNullException.ThrowIfNull(summary);
        return new RhythmClockResponse
        {
            Status = RhythmWire.Status(summary.Status),
            Usual = summary.Usual is { } usual ? RhythmWire.Clock(usual) : null,
            SpreadMinutes = RhythmWire.Minutes(summary.Spread),
            Nights = summary.Nights,
        };
    }
}

/// <summary>Durations in whole minutes: 25th percentile, median, 75th percentile of <c>count</c> samples.</summary>
public sealed class RhythmDurationResponse
{
    public string Status { get; set; } = string.Empty;

    public int Count { get; set; }

    public int? P25Minutes { get; set; }

    public int? MedianMinutes { get; set; }

    public int? P75Minutes { get; set; }

    public static implicit operator RhythmDurationResponse(DurationSummary summary)
    {
        ArgumentNullException.ThrowIfNull(summary);
        return new RhythmDurationResponse
        {
            Status = RhythmWire.Status(summary.Status),
            Count = summary.Count,
            P25Minutes = RhythmWire.Minutes(summary.P25),
            MedianMinutes = RhythmWire.Minutes(summary.Median),
            P75Minutes = RhythmWire.Minutes(summary.P75),
        };
    }
}

/// <summary>Naps per bracketed day (<c>count</c> days) and the usual nap starts (by usual time, empty when none).</summary>
public sealed class RhythmNapsResponse
{
    public string Status { get; set; } = string.Empty;

    public int Count { get; set; }

    public double? P25 { get; set; }

    public double? Median { get; set; }

    public double? P75 { get; set; }

    public IReadOnlyList<RhythmNapStartResponse> UsualStarts { get; set; } = [];

    public static implicit operator RhythmNapsResponse(NapRhythm naps)
    {
        ArgumentNullException.ThrowIfNull(naps);
        return new RhythmNapsResponse
        {
            Status = RhythmWire.Status(naps.PerDay.Status),
            Count = naps.PerDay.Count,
            P25 = RhythmWire.Count(naps.PerDay.P25),
            Median = RhythmWire.Count(naps.PerDay.Median),
            P75 = RhythmWire.Count(naps.PerDay.P75),
            UsualStarts = naps.UsualStarts.Select(pattern => (RhythmNapStartResponse)pattern).ToArray(),
        };
    }
}

/// <summary>A usual nap start: local <c>HH:mm</c> usual time and window, spread, supporting days and days with a nap.</summary>
public sealed class RhythmNapStartResponse
{
    public string Usual { get; set; } = string.Empty;

    public string WindowStart { get; set; } = string.Empty;

    public string WindowEnd { get; set; } = string.Empty;

    public int SpreadMinutes { get; set; }

    /// <summary>Days with a nap start inside the window.</summary>
    public int Days { get; set; }

    /// <summary>Days of the detector's look-back with any nap start left to it.</summary>
    public int EventDays { get; set; }

    public static implicit operator RhythmNapStartResponse(TimeOfDayPattern pattern)
    {
        ArgumentNullException.ThrowIfNull(pattern);
        return new RhythmNapStartResponse
        {
            Usual = RhythmWire.Clock(pattern.Typical),
            WindowStart = RhythmWire.Clock(pattern.WindowStart),
            WindowEnd = RhythmWire.Clock(pattern.WindowEnd),
            SpreadMinutes = RhythmWire.Minutes(pattern.Spread) ?? 0,
            Days = pattern.Days.Count,
            EventDays = pattern.EventDayCount,
        };
    }
}

/// <summary>Feeds per local day with a feed (<c>count</c> days) and the gap between feed starts.</summary>
public sealed class RhythmFeedsResponse
{
    public string Status { get; set; } = string.Empty;

    public int Count { get; set; }

    public double? P25 { get; set; }

    public double? Median { get; set; }

    public double? P75 { get; set; }

    public RhythmDurationResponse Gap { get; set; } = new();

    public static implicit operator RhythmFeedsResponse(FeedRhythm feeds)
    {
        ArgumentNullException.ThrowIfNull(feeds);
        return new RhythmFeedsResponse
        {
            Status = RhythmWire.Status(feeds.PerDay.Status),
            Count = feeds.PerDay.Count,
            P25 = RhythmWire.Count(feeds.PerDay.P25),
            Median = RhythmWire.Count(feeds.PerDay.Median),
            P75 = RhythmWire.Count(feeds.PerDay.P75),
            Gap = feeds.Gap,
        };
    }
}

/// <summary>A factor (<c>evening_feeds</c>, <c>dirty_diaper_day</c>) and its outcomes, always in the order night length, longest stretch, first stretch.</summary>
public sealed class RhythmAssociationResponse
{
    public string Factor { get; set; } = string.Empty;

    /// <summary>For <c>evening_feeds</c>: "with" = this many evening feeds or more; <c>null</c> otherwise or when no night qualified.</summary>
    public int? Threshold { get; set; }

    public IReadOnlyList<RhythmAssociationOutcomeResponse> Outcomes { get; set; } = [];

    public static implicit operator RhythmAssociationResponse(RhythmAssociation association)
    {
        ArgumentNullException.ThrowIfNull(association);
        return new RhythmAssociationResponse
        {
            Factor = association.Factor == RhythmFactor.EveningFeeds ? "evening_feeds" : "dirty_diaper_day",
            Threshold = association.Threshold,
            Outcomes = association.Outcomes.Select(outcome => (RhythmAssociationOutcomeResponse)outcome).ToArray(),
        };
    }
}

/// <summary>
/// One outcome: <c>status</c> <c>ok</c>, <c>no_clear_difference</c> or <c>not_enough_data</c>; the group sizes always; the
/// medians and the difference (with minus without) only when ok; the nights' own spread when any night qualified.
/// </summary>
public sealed class RhythmAssociationOutcomeResponse
{
    public string Outcome { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public int NightsWith { get; set; }

    public int NightsWithout { get; set; }

    public int? MedianWithMinutes { get; set; }

    public int? MedianWithoutMinutes { get; set; }

    public int? DifferenceMinutes { get; set; }

    public int? SpreadMinutes { get; set; }

    public static implicit operator RhythmAssociationOutcomeResponse(AssociationOutcome outcome)
    {
        ArgumentNullException.ThrowIfNull(outcome);
        return new RhythmAssociationOutcomeResponse
        {
            Outcome = RhythmWire.Outcome(outcome.Outcome),
            Status = RhythmWire.Status(outcome.Status),
            NightsWith = outcome.NightsWith,
            NightsWithout = outcome.NightsWithout,
            MedianWithMinutes = RhythmWire.Minutes(outcome.MedianWith),
            MedianWithoutMinutes = RhythmWire.Minutes(outcome.MedianWithout),
            DifferenceMinutes = RhythmWire.Minutes(outcome.Difference),
            SpreadMinutes = RhythmWire.Minutes(outcome.Spread),
        };
    }
}

/// <summary>The rules the rhythm was measured by, so clients can state them in plain words.</summary>
public sealed class RhythmRuleResponse
{
    public int LookBackDays { get; set; }

    /// <summary>Local <c>HH:mm</c> an evening day starts at.</summary>
    public string EveningDayStartsAt { get; set; } = string.Empty;

    public int MinimumNights { get; set; }

    public int MinimumDays { get; set; }

    public int MinimumFeedGaps { get; set; }

    public int MaximumClockSpreadMinutes { get; set; }

    public int MinimumNightMinutes { get; set; }

    public int MaximumNightMinutes { get; set; }

    public int MaximumFeedGapMinutes { get; set; }

    public int EveningFeedWindowMinutes { get; set; }

    public int MinimumGroupNights { get; set; }

    public int MinimumDifferenceMinutes { get; set; }

    public static RhythmRuleResponse For(RhythmOptions rules)
    {
        ArgumentNullException.ThrowIfNull(rules);
        return new RhythmRuleResponse
        {
            LookBackDays = rules.LookBackDays,
            EveningDayStartsAt = RhythmWire.Clock(rules.EveningDayStartsAt),
            MinimumNights = rules.MinimumNights,
            MinimumDays = rules.MinimumDays,
            MinimumFeedGaps = rules.MinimumFeedGaps,
            MaximumClockSpreadMinutes = RhythmWire.Minutes(rules.MaximumClockSpread) ?? 0,
            MinimumNightMinutes = RhythmWire.Minutes(rules.MinimumNightLength) ?? 0,
            MaximumNightMinutes = RhythmWire.Minutes(rules.MaximumNightLength) ?? 0,
            MaximumFeedGapMinutes = RhythmWire.Minutes(rules.MaximumFeedGap) ?? 0,
            EveningFeedWindowMinutes = RhythmWire.Minutes(rules.EveningFeedWindow) ?? 0,
            MinimumGroupNights = rules.MinimumGroupNights,
            MinimumDifferenceMinutes = RhythmWire.Minutes(rules.MinimumDifference) ?? 0,
        };
    }
}

/// <summary>The wire spellings of the rhythm (statuses, outcomes, clocks, dates, minutes, counts).</summary>
internal static class RhythmWire
{
    public static string Status(RhythmStatus status) => status switch
    {
        RhythmStatus.Ok => "ok",
        RhythmStatus.Varies => "varies",
        RhythmStatus.NoClearDifference => "no_clear_difference",
        _ => "not_enough_data",
    };

    public static string Outcome(RhythmOutcome outcome) => outcome switch
    {
        RhythmOutcome.NightLength => "night_length",
        RhythmOutcome.LongestStretch => "longest_stretch",
        _ => "first_stretch",
    };

    public static string Clock(TimeOnly clock) => clock.ToString("HH:mm", CultureInfo.InvariantCulture);

    public static string Date(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static int? Minutes(TimeSpan? value) => value is { } length ? (int)Math.Round(length.TotalMinutes, MidpointRounding.AwayFromZero) : null;

    public static double? Count(double? value) => value is { } count ? Math.Round(count, 1, MidpointRounding.AwayFromZero) : null;
}
