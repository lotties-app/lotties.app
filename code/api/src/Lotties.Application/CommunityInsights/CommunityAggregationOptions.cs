namespace Lotties.Application.CommunityInsights;

/// <summary>
/// Configuration for <see cref="CommunityAggregationJob"/> (docs/design/34-community-insights.md section 5): the on/off switch only.
/// The schedule is not configurable: releases are quarterly (owner decision of 2026-11-27), decided from the latest stored release
/// (<see cref="Lotties.Domain.CommunityInsights.CommunityReleaseCadence"/>), so no setting can make the job publish more often.
/// </summary>
public sealed class CommunityAggregationOptions
{
    public const string SectionName = "CommunityAggregation";

    /// <summary>Whether the job runs. Off by default.</summary>
    public bool Enabled { get; set; }

    /// <summary>Maximum number of babies to process per run (safety limit; 0 = unlimited). Not read yet (no event loading).</summary>
    public int MaxBabiesPerRun { get; set; }
}
