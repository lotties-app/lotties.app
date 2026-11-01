using System.Globalization;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;

namespace Lotties.Application.Predictions;

/// <summary>
/// The overtired heads-up numbers (docs/design/11-patterns.md section 6): the baby's usual longest comfortable awake
/// stretch and the awake stretch going on now. Instants are UTC; lengths are whole minutes. Clients build their own
/// text; there is no prose.
/// </summary>
public sealed class WakeWindowResponse
{
    /// <summary>The usual longest comfortable awake stretch (the percentile of <see cref="Stretches"/>).</summary>
    public int LimitMinutes { get; set; }

    /// <summary>Number of stretches the limit comes from.</summary>
    public int SampleCount { get; set; }

    /// <summary>When the current awake stretch started (UTC), or <c>null</c> while asleep or after a night waking.</summary>
    public DateTimeOffset? AwakeSince { get; set; }

    /// <summary>Whole minutes awake at <see cref="PredictionsResponse.GeneratedAt"/>, or <c>null</c> without a current stretch.</summary>
    public int? AwakeMinutes { get; set; }

    /// <summary>The IANA zone the daytime rule was read in, or <c>null</c> when the fixed <c>utcOffsetMinutes</c> was used.</summary>
    public string? TimeZone { get; set; }

    /// <summary>The stretches used, oldest first.</summary>
    public IReadOnlyList<AwakeStretchResponse> Stretches { get; set; } = [];

    public WakeWindowRuleResponse Rule { get; set; } = new();

    public static WakeWindowResponse For(WakeWindow window, DateTimeOffset now, LocalClock clock, WakeWindowOptions rules)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(rules);
        return new WakeWindowResponse
        {
            LimitMinutes = WholeMinutes.Of(window.Limit),
            SampleCount = window.Stretches.Count,
            AwakeSince = window.AwakeSince?.ToUniversalTime(),
            AwakeMinutes = window.AwakeFor(now) is { } awake ? (int)Math.Floor(awake.TotalMinutes) : null,
            TimeZone = clock.TimeZoneId,
            Stretches = window.Stretches.Select(stretch => (AwakeStretchResponse)stretch).ToArray(),
            Rule = WakeWindowRuleResponse.For(rules),
        };
    }
}

/// <summary>One awake stretch used: its UTC start and end and its length in whole minutes.</summary>
public sealed class AwakeStretchResponse
{
    public DateTimeOffset Start { get; set; }

    public DateTimeOffset End { get; set; }

    public int Minutes { get; set; }

    public static implicit operator AwakeStretchResponse(AwakeStretch stretch)
    {
        ArgumentNullException.ThrowIfNull(stretch);
        return new AwakeStretchResponse
        {
            Start = stretch.Start.ToUniversalTime(),
            End = stretch.End.ToUniversalTime(),
            Minutes = WholeMinutes.Of(stretch.Length),
        };
    }
}

/// <summary>The rule the limit was computed by, so clients can state it in plain words.</summary>
public sealed class WakeWindowRuleResponse
{
    private const string ClockFormat = "HH:mm";

    public int LookBackDays { get; set; }

    /// <summary>Local <c>HH:mm</c> from which a stretch counts as daytime (inclusive).</summary>
    public string DayStartsAt { get; set; } = string.Empty;

    /// <summary>Local <c>HH:mm</c> before which a daytime stretch starts (exclusive).</summary>
    public string DayEndsAt { get; set; } = string.Empty;

    /// <summary>The percentile of the stretches the limit is (75).</summary>
    public int Percentile { get; set; }

    public int MinimumStretches { get; set; }

    /// <summary>The heads-up starts this long before the limit.</summary>
    public int LeadMinutes { get; set; }

    /// <summary>The heads-up stays until this long after the limit.</summary>
    public int GraceMinutes { get; set; }

    public static WakeWindowRuleResponse For(WakeWindowOptions rules)
    {
        ArgumentNullException.ThrowIfNull(rules);
        return new WakeWindowRuleResponse
        {
            LookBackDays = WholeDays.Of(rules.LookBack),
            DayStartsAt = rules.DayStartsAt.ToString(ClockFormat, CultureInfo.InvariantCulture),
            DayEndsAt = rules.DayEndsAt.ToString(ClockFormat, CultureInfo.InvariantCulture),
            Percentile = (int)Math.Round(rules.Percentile * 100, MidpointRounding.AwayFromZero),
            MinimumStretches = rules.MinimumStretches,
            LeadMinutes = WholeMinutes.Of(rules.Lead),
            GraceMinutes = WholeMinutes.Of(rules.Grace),
        };
    }
}
