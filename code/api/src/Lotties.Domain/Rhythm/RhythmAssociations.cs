using Lotties.Domain.Predictions;

namespace Lotties.Domain.Rhythm;

/// <summary>
/// The descriptive associations of a rhythm (docs/design/48-baby-rhythm.md section 4): two groups of the baby's own
/// counted nights, split by what happened during the day before (from <see cref="RhythmOptions.EveningDayStartsAt"/> on
/// the evening's date to the bed time), and the medians of each outcome. Never a cause, never a score.
/// </summary>
internal static class RhythmAssociations
{
    private static readonly RhythmOutcome[] Outcomes = [RhythmOutcome.NightLength, RhythmOutcome.LongestStretch, RhythmOutcome.FirstStretch];

    public static IReadOnlyList<RhythmAssociation> Measure(
        IReadOnlyList<RhythmNight> nights,
        IReadOnlyList<ObservedEvent> feeds,
        IReadOnlyList<ObservedEvent> diapers,
        RhythmWindow window,
        RhythmOptions rules) =>
        [EveningFeeds(nights, feeds, window, rules), DirtyDiaperDay(nights, diapers, window, rules)];

    /// <summary>
    /// Nights whose day had a feed, split at N = the median of their evening feed counts (feeds started in the window before
    /// bed time), rounded up, at least 1: N or more vs fewer.
    /// </summary>
    private static RhythmAssociation EveningFeeds(IReadOnlyList<RhythmNight> nights, IReadOnlyList<ObservedEvent> feeds, RhythmWindow window, RhythmOptions rules)
    {
        var qualifying = nights
            .Where(night => DayOf(night, feeds, window).Any())
            .Select(night => new CountedNight(night, feeds.Count(feed => feed.StartedAt >= night.BedTime - rules.EveningFeedWindow && feed.StartedAt < night.BedTime)))
            .ToArray();
        int? threshold = qualifying.Length == 0
            ? null
            : Math.Max(1, (int)Math.Ceiling(RhythmStatistics.Median(qualifying.Select(item => item.Count).ToArray())));
        var with = qualifying.Where(item => item.Count >= threshold).Select(item => item.Night).ToArray();
        var without = qualifying.Where(item => item.Count < threshold).Select(item => item.Night).ToArray();
        return new RhythmAssociation(RhythmFactor.EveningFeeds, threshold, Compare(with, without, rules));
    }

    /// <summary>Nights whose day had a diaper logged: a dirty one vs none dirty.</summary>
    private static RhythmAssociation DirtyDiaperDay(IReadOnlyList<RhythmNight> nights, IReadOnlyList<ObservedEvent> diapers, RhythmWindow window, RhythmOptions rules)
    {
        var qualifying = nights
            .Select(night => new { Night = night, Diapers = DayOf(night, diapers, window).ToArray() })
            .Where(item => item.Diapers.Length > 0)
            .ToArray();
        var with = qualifying.Where(item => item.Diapers.Any(diaper => DiaperContents.IsDirty(diaper.Content))).Select(item => item.Night).ToArray();
        var without = qualifying.Where(item => !item.Diapers.Any(diaper => DiaperContents.IsDirty(diaper.Content))).Select(item => item.Night).ToArray();
        return new RhythmAssociation(RhythmFactor.DirtyDiaperDay, null, Compare(with, without, rules));
    }

    /// <summary>The events that started during the night's day: from its evening's day start to its bed time.</summary>
    private static IEnumerable<ObservedEvent> DayOf(RhythmNight night, IReadOnlyList<ObservedEvent> events, RhythmWindow window)
    {
        var dayStart = window.DayStartOf(night.Evening);
        return events.Where(item => item.StartedAt >= dayStart && item.StartedAt < night.BedTime);
    }

    private static IReadOnlyList<AssociationOutcome> Compare(IReadOnlyList<RhythmNight> with, IReadOnlyList<RhythmNight> without, RhythmOptions rules) =>
        Outcomes.Select(outcome => Compare(outcome, with.Select(night => night.Of(outcome)).ToArray(), without.Select(night => night.Of(outcome)).ToArray(), rules)).ToArray();

    private static AssociationOutcome Compare(RhythmOutcome outcome, IReadOnlyList<TimeSpan> with, IReadOnlyList<TimeSpan> without, RhythmOptions rules)
    {
        var all = with.Concat(without).ToArray();
        TimeSpan? spread = all.Length == 0 ? null : RhythmStatistics.MedianAbsoluteDeviation(all);
        if (with.Count < rules.MinimumGroupNights || without.Count < rules.MinimumGroupNights)
        {
            return new AssociationOutcome(outcome, RhythmStatus.NotEnoughData, with.Count, without.Count, null, null, null, spread);
        }

        var medianWith = RhythmStatistics.Median(with);
        var medianWithout = RhythmStatistics.Median(without);
        var difference = medianWith - medianWithout;
        return difference.Duration() >= rules.MinimumDifference && difference.Duration() > spread
            ? new AssociationOutcome(outcome, RhythmStatus.Ok, with.Count, without.Count, medianWith, medianWithout, difference, spread)
            : new AssociationOutcome(outcome, RhythmStatus.NoClearDifference, with.Count, without.Count, null, null, null, spread);
    }

    private sealed record CountedNight(RhythmNight Night, int Count);
}
