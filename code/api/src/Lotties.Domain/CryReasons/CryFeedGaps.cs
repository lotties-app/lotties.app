namespace Lotties.Domain.CryReasons;

/// <summary>One gap between two feed sessions: when the first one started and the gap in minutes.</summary>
public sealed record CryFeedGap(DateTimeOffset From, double Minutes);

/// <summary>
/// Her recent feed gaps as the web's <c>feedSessionGaps</c> reads them: the feed starts of the last
/// <see cref="CryWeights.FeedHistoryHours"/> up to now, merged into sessions when closer than
/// <see cref="CryWeights.FeedMergeMinutes"/>, and the start-to-start gaps up to <see cref="CryWeights.FeedGapMaxMinutes"/>
/// (longer ones are a missed log, not a gap).
/// </summary>
public static class CryFeedGaps
{
    public static IReadOnlyList<CryFeedGap> Between(IEnumerable<DateTimeOffset> feedStarts, DateTimeOffset now, CryWeights? weights = null)
    {
        ArgumentNullException.ThrowIfNull(feedStarts);
        var rules = weights ?? CryWeights.Default;
        var from = now - TimeSpan.FromHours(rules.FeedHistoryHours);
        var sessions = Sessions(feedStarts.Where(start => start >= from && start <= now).Order(), TimeSpan.FromMinutes(rules.FeedMergeMinutes));
        return sessions
            .Skip(1)
            .Select((start, index) => new CryFeedGap(sessions[index], (start - sessions[index]).TotalMinutes))
            .Where(gap => gap.Minutes <= rules.FeedGapMaxMinutes)
            .ToArray();
    }

    private static IReadOnlyList<DateTimeOffset> Sessions(IEnumerable<DateTimeOffset> orderedStarts, TimeSpan merge)
    {
        var sessions = new List<DateTimeOffset>();
        foreach (var start in orderedStarts)
        {
            if (sessions.Count == 0 || start - sessions[^1] >= merge)
            {
                sessions.Add(start);
            }
        }

        return sessions;
    }
}
