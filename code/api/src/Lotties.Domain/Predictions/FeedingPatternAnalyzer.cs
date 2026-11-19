namespace Lotties.Domain.Predictions;

/// <summary>
/// Pure domain analysis of feeding patterns. No I/O. Used to flag top-up feeds and retrospective corrections
/// that improve volume prediction accuracy.
/// </summary>
public static class FeedingPatternAnalyzer
{
    /// <summary>Default threshold: two feeds within 15 minutes suggest the first was incomplete.</summary>
    public static readonly TimeSpan DefaultTopUpThreshold = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Returns true when <paramref name="previousFeed"/> exists, shares the same event type as
    /// <paramref name="currentFeed"/>, and the gap between the previous feed's end (or start if still running)
    /// and the current feed's start is less than <paramref name="threshold"/>. A top-up suggests the baby did
    /// not finish the earlier bottle or breast, so volume predictions should weight it differently.
    /// </summary>
    public static bool IsTopUpFeed(ObservedEvent currentFeed, ObservedEvent? previousFeed, TimeSpan threshold)
    {
        if (previousFeed is null)
        {
            return false;
        }

        if (!currentFeed.TypeKey.Equals(previousFeed.TypeKey))
        {
            return false;
        }

        var previousEnd = previousFeed.EndedAt ?? previousFeed.StartedAt;
        var gap = currentFeed.StartedAt - previousEnd;

        return gap >= TimeSpan.Zero && gap < threshold;
    }

    /// <summary>Overload using the default 15-minute threshold.</summary>
    public static bool IsTopUpFeed(ObservedEvent currentFeed, ObservedEvent? previousFeed) =>
        IsTopUpFeed(currentFeed, previousFeed, DefaultTopUpThreshold);

    /// <summary>
    /// Determines whether an event was logged retrospectively rather than in real time. An event is retrospective
    /// when it was created more than <paramref name="lagThreshold"/> after its own <paramref name="startedAt"/>.
    /// Default threshold is 2 hours. Retrospective entries are common for overnight catch-up logging but add noise
    /// to interval-based predictions because the parent's memory of timing is approximate.
    /// </summary>
    public static bool IsRetrospectiveEntry(DateTimeOffset createdAt, DateTimeOffset startedAt, TimeSpan? lagThreshold = null)
    {
        var threshold = lagThreshold ?? TimeSpan.FromHours(2);
        var lag = createdAt - startedAt;
        return lag > threshold;
    }
}