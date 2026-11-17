using Lotties.Domain.AgeNorms;
using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>
/// A prediction seed derived from published age norms when a baby has too few logged events. Pure, no I/O: the caller
/// resolves the norm from <see cref="AgeNormSet"/> and passes it in. Only norms that
/// <see cref="AgeNorm.IsUsableAsPrior"/> may be used (the caller checks via <see cref="AgeNormSet.PriorFor"/>).
/// </summary>
internal sealed record ColdStartPrior(
    EventTypeKey TypeKey,
    TimeSpan MedianGap,
    TimeSpan? TypicalDuration,
    int AgeDays,
    string Metric);

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

    private static TimeSpan? ToTimeSpan(decimal value, string unit) => unit switch
    {
        "minutes" => TimeSpan.FromMinutes((double)value),
        "hours" => TimeSpan.FromHours((double)value),
        _ => null,
    };
}