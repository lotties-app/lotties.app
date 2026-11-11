using Lotties.Domain.Clinical;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Patterns;

namespace Lotties.Domain.Rhythm;

/// <summary>
/// The rules of <see cref="BabyRhythm.Measure"/> (docs/design/48-baby-rhythm.md). <see cref="Default"/> holds the shipped
/// values; other instances exist for tests.
/// </summary>
public sealed record RhythmOptions
{
    public static RhythmOptions Default { get; } = new();

    /// <summary>Local days looked at, ending yesterday (today is never counted: it is not finished).</summary>
    public int LookBackDays { get; init; } = 28;

    /// <summary>
    /// Local time when an evening day begins: a night belongs to the local date of its bed time read on a day that starts
    /// here (a 00:30 bed time belongs to the previous evening), and the day before a night starts here.
    /// </summary>
    public TimeOnly EveningDayStartsAt { get; init; } = new(4, 0);

    /// <summary>Fewest counted nights for the bed time, wake-up, night length and stretches.</summary>
    public int MinimumNights { get; init; } = 5;

    /// <summary>Fewest days for the naps per day and the feeds per day.</summary>
    public int MinimumDays { get; init; } = 5;

    /// <summary>Fewest gaps between feeds for the typical gap.</summary>
    public int MinimumFeedGaps { get; init; } = 10;

    /// <summary>A bed-time or wake-up spread (circular standard deviation) over this is reported as varying, with no usual time.</summary>
    public TimeSpan MaximumClockSpread { get; init; } = TimeSpan.FromMinutes(90);

    /// <summary>A merged night shorter than this is left out (a mis-tagged nap).</summary>
    public TimeSpan MinimumNightLength { get; init; } = TimeSpan.FromHours(3);

    /// <summary>A merged night longer than this is left out (a forgotten timer); also the longest bed-time to wake-up pair.</summary>
    public TimeSpan MaximumNightLength { get; init; } = TimeSpan.FromHours(16);

    /// <summary>Pieces of a night's sleep shorter than this are dropped (overlapping or duplicate logs).</summary>
    public TimeSpan MinimumStretchLength { get; init; } = TimeSpan.FromMinutes(1);

    /// <summary>A longer gap between two feeds is a feed that was not logged and is left out (as the clinical summary).</summary>
    public TimeSpan MaximumFeedGap { get; init; } = FeedingSummaries.MaxFeedGap;

    /// <summary>Feeds that started this long before bed time or later are the night's evening feeds.</summary>
    public TimeSpan EveningFeedWindow { get; init; } = TimeSpan.FromHours(4);

    /// <summary>Fewest nights each group of an association needs.</summary>
    public int MinimumGroupNights { get; init; } = 7;

    /// <summary>Smallest difference of the medians an association reports (it must also exceed the nights' own spread).</summary>
    public TimeSpan MinimumDifference { get; init; } = TimeSpan.FromMinutes(20);

    /// <summary>Most usual nap starts looked for.</summary>
    public int MaximumNapPatterns { get; init; } = 4;

    /// <summary>The detector rules the usual nap starts are found with.</summary>
    public RecurringTimeOfDayOptions NapPatterns { get; init; } = RecurringTimeOfDayOptions.Default;

    public EventTypeKey SleepTypeKey { get; init; } = BuiltInEventTypes.Sleep.Key;

    public EventTypeKey FeedingTypeKey { get; init; } = BuiltInEventTypes.Feeding.Key;

    public EventTypeKey DiaperTypeKey { get; init; } = BuiltInEventTypes.Diaper.Key;
}
