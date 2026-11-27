namespace Lotties.Application.CommunityInsights;

/// <summary>
/// Configuration for <see cref="CommunityAggregationJob"/> (docs/design/34-community-insights.md sections 5 and 5.3). The schedule is
/// not configurable: releases are quarterly (owner decision of 2026-11-27), decided from the latest stored release
/// (<see cref="Lotties.Domain.CommunityInsights.CommunityReleaseCadence"/>), so no setting can make the job publish more often.
/// </summary>
public sealed class CommunityAggregationOptions
{
    public const string SectionName = "CommunityAggregation";

    /// <summary>Whether the job runs. Off by default.</summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Whether a run reads the events of the opted-in babies and publishes a release with statistics. Off by default, and no settings
    /// file, chart or deploy value in the repository turns it on: the owner turns it on in the same deploy as the privacy policy that
    /// describes the feature as active. While it is off a run reads no event or other data-plane table and behaves as before it existed
    /// (it writes at most one placeholder per quarter).
    /// </summary>
    public bool ReadEvents { get; set; }

    /// <summary>
    /// The secret key of the per-baby day and cell caps, base64 of at least 32 bytes (<c>CommunityAggregation__CapKey</c>, from a
    /// Kubernetes Secret). Needed only while <see cref="ReadEvents"/> is on; missing, not base64 or too short, the run reads nothing and
    /// publishes nothing. It must stay the same between releases (docs/DEPLOY.md "Community statistics"). Never logged.
    /// </summary>
    public string? CapKey { get; set; }

    /// <summary>
    /// The most eligible babies one run may read (0 = no limit). A run whose population is larger reads nothing and publishes nothing
    /// (a release over a truncated population would be biased), and says so in the log; raise the limit to publish.
    /// </summary>
    public int MaxBabiesPerRun { get; set; }
}
