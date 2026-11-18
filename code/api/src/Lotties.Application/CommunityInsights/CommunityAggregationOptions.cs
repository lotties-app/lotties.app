namespace Lotties.Application.CommunityInsights;

/// <summary>
/// Configuration for <see cref="CommunityAggregationJob"/> (docs/design/34-community-insights.md section 5): the weekly run
/// schedule and feature gate. Off by default; turning it on in production is task T9 (activation), never before the consent
/// infrastructure and catalog are validated.
/// </summary>
public sealed class CommunityAggregationOptions
{
    public const string SectionName = "CommunityAggregation";

    /// <summary>Whether the weekly aggregation job runs. Off by default.</summary>
    public bool Enabled { get; set; }

    /// <summary>Day of week for the weekly run (0 = Sunday, 1 = Monday, ...). Default: Monday.</summary>
    public DayOfWeek RunDayOfWeek { get; set; } = DayOfWeek.Monday;

    /// <summary>Hour of day (UTC) for the weekly run. Default: 03:00 UTC.</summary>
    public int RunHourUtc { get; set; } = 3;

    /// <summary>Maximum number of babies to process per run (safety limit; 0 = unlimited).</summary>
    public int MaxBabiesPerRun { get; set; }
}