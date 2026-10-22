using System.Globalization;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Patterns;

namespace Lotties.Application.Predictions;

/// <summary>
/// A time of day an event type keeps happening at (docs/design/11-patterns.md), in the family's local wall-clock times
/// (<c>HH:mm</c>; the window crosses midnight when <see cref="WindowEnd"/> is earlier than <see cref="WindowStart"/>).
/// Clients build their own text from these numbers; there is no prose.
/// </summary>
public sealed class TimeOfDayPatternResponse
{
    private const string ClockFormat = "HH:mm";

    /// <summary>The event type the pattern is about (<c>belly_pain</c> or <c>fussy</c>).</summary>
    public string TypeKey { get; set; } = string.Empty;

    /// <summary>The usual time (circular mean of the days).</summary>
    public string TypicalClock { get; set; } = string.Empty;

    public string WindowStart { get; set; } = string.Empty;

    public string WindowEnd { get; set; } = string.Empty;

    public int WindowMinutes { get; set; }

    /// <summary>Circular standard deviation of the days' times, whole minutes.</summary>
    public int SpreadMinutes { get; set; }

    /// <summary><c>Low</c>, <c>Medium</c> or <c>High</c>.</summary>
    public string Confidence { get; set; } = string.Empty;

    /// <summary>Days of the look-back with any event of the type.</summary>
    public int EventDayCount { get; set; }

    /// <summary>Supporting days in the recent part of the look-back.</summary>
    public int RecentDayCount { get; set; }

    /// <summary>The IANA zone the local times are in, or <c>null</c> when the fixed <c>utcOffsetMinutes</c> was used.</summary>
    public string? TimeZone { get; set; }

    /// <summary>The supporting days, oldest first: the local date and the times inside the window.</summary>
    public IReadOnlyList<PatternDayResponse> Days { get; set; } = [];

    public PatternRuleResponse Rule { get; set; } = new();

    /// <param name="lead">How long before the window the suggestion shows (and a logged event counts as handled).</param>
    public static TimeOfDayPatternResponse For(EventTypeKey typeKey, TimeOfDayPattern pattern, LocalClock clock, RecurringTimeOfDayOptions rules, TimeSpan lead)
    {
        ArgumentNullException.ThrowIfNull(pattern);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(rules);
        return new TimeOfDayPatternResponse
        {
            TypeKey = typeKey.Value,
            TypicalClock = Clock(pattern.Typical),
            WindowStart = Clock(pattern.WindowStart),
            WindowEnd = Clock(pattern.WindowEnd),
            WindowMinutes = WholeMinutes.Of(pattern.Width),
            SpreadMinutes = WholeMinutes.Of(pattern.Spread),
            Confidence = pattern.Confidence.ToString(),
            EventDayCount = pattern.EventDayCount,
            RecentDayCount = pattern.RecentDayCount,
            TimeZone = clock.TimeZoneId,
            Days = pattern.Days.Select(day => (PatternDayResponse)day).ToArray(),
            Rule = PatternRuleResponse.For(rules, lead),
        };
    }

    internal static string Clock(TimeOnly time) => time.ToString(ClockFormat, CultureInfo.InvariantCulture);
}

/// <summary>One supporting day: <c>yyyy-MM-dd</c> and its local times (<c>HH:mm</c>) inside the window, in order.</summary>
public sealed class PatternDayResponse
{
    public string Date { get; set; } = string.Empty;

    public IReadOnlyList<string> Times { get; set; } = [];

    public static implicit operator PatternDayResponse(PatternDay day)
    {
        ArgumentNullException.ThrowIfNull(day);
        return new PatternDayResponse
        {
            Date = day.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            Times = day.Times.Select(TimeOfDayPatternResponse.Clock).ToArray(),
        };
    }
}

/// <summary>The rule the pattern was accepted by, so clients can state it in plain words.</summary>
public sealed class PatternRuleResponse
{
    public int LookBackDays { get; set; }

    public int RecentDays { get; set; }

    public int MinimumRecentDays { get; set; }

    public int MaximumSpreadMinutes { get; set; }

    public int MinimumCoveragePercent { get; set; }

    /// <summary>How long before the window the suggestion shows.</summary>
    public int LeadMinutes { get; set; }

    public static PatternRuleResponse For(RecurringTimeOfDayOptions rules, TimeSpan lead)
    {
        ArgumentNullException.ThrowIfNull(rules);
        return new PatternRuleResponse
        {
            LookBackDays = rules.LookBackDays,
            RecentDays = rules.RecentDays,
            MinimumRecentDays = rules.MinimumRecentDays,
            MaximumSpreadMinutes = WholeMinutes.Of(rules.MaximumSpread),
            MinimumCoveragePercent = (int)Math.Round(rules.MinimumCoverage * 100, MidpointRounding.AwayFromZero),
            LeadMinutes = WholeMinutes.Of(lead),
        };
    }
}
