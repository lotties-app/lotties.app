using Lotties.Domain.AgeNorms;
using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>Identifies where a cold-start prior came from.</summary>
public enum PriorOrigin
{
    /// <summary>Derived from published age norms (e.g. WHO, CDC).</summary>
    PublishedNorm,

    /// <summary>Derived from pre-computed community statistics baked into the release.</summary>
    CommunityStatic,

    /// <summary>Derived from live community aggregates (future phase).</summary>
    CommunityLive,
}

/// <summary>
/// A prediction seed derived from published age norms when a baby has too few logged events. Pure, no I/O: the caller
/// resolves the norm from <see cref="AgeNormSet"/> and passes it in. Only norms that
/// <see cref="AgeNorm.IsUsableAsPrior"/> may be used (the caller checks via <see cref="AgeNormSet.PriorFor"/>).
/// </summary>
public sealed record ColdStartPrior(
    EventTypeKey TypeKey,
    TimeSpan MedianGap,
    TimeSpan? TypicalDuration,
    int AgeDays,
    string Metric,
    PriorOrigin Origin = PriorOrigin.PublishedNorm,
    double? PriorWeight = null,
    double? PriorLogSd = null);

/// <summary>Maps event types to the age-norm metric keys that can seed their cold-start predictions.</summary>
internal static class ColdStartMetrics
{
    /// <summary>The metric key for an event type, or <c>null</c> when no norm applies.</summary>
    public static string? For(EventTypeKey typeKey) => typeKey.Value switch
    {
        "feeding" => AgeNormMetrics.FeedGapMinutes,
        "sleep" => null, // wake windows have no published norm (docs/design/28-age-norms.md metric notes)
        _ => null,
    };

    /// <summary>
    /// Builds a cold-start prior from a resolved norm. Returns <c>null</c> when the norm has no typical value or the
    /// unit cannot be converted to a gap.
    /// </summary>
    public static ColdStartPrior? FromNorm(EventTypeKey typeKey, AgeNorm norm, int ageDays)
    {
        if (norm.Typical is null)
        {
            return null;
        }

        var metric = For(typeKey);
        if (metric is null)
        {
            return null;
        }

        var medianGap = ToTimeSpan(norm.Typical.Value, norm.Unit);
        if (medianGap is null || medianGap <= TimeSpan.Zero)
        {
            return null;
        }

        return new ColdStartPrior(typeKey, medianGap.Value, null, ageDays, metric);
    }

    /// <summary>
    /// Builds a cold-start prior from pre-computed community statistics. Returns <c>null</c> when the gap is not positive.
    /// </summary>
    public static ColdStartPrior? FromCommunityStatic(EventTypeKey typeKey, TimeSpan medianGap, int ageDays, string metric)
    {
        if (medianGap <= TimeSpan.Zero)
        {
            return null;
        }

        return new ColdStartPrior(typeKey, medianGap, null, ageDays, metric, PriorOrigin.CommunityStatic);
    }

    private static TimeSpan? ToTimeSpan(decimal value, string unit) => unit switch
    {
        "minutes" => TimeSpan.FromMinutes((double)value),
        "hours" => TimeSpan.FromHours((double)value),
        _ => null,
    };
}