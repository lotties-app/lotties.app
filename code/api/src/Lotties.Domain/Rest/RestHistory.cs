namespace Lotties.Domain.Rest;

/// <summary>
/// Everything one history reads. <see cref="LastNight"/> is the local date the newest night of the window started (normally
/// <see cref="RestHistoryBuilder.LastFinishedNight"/>); <see cref="Nights"/> is 14 or 28; <see cref="MorningAnswers"/> holds the
/// person's "up for the day" answers by night; <see cref="Events"/> are the events of every baby the person belongs to,
/// covering every night's event window (<see cref="RestCalendar.EventWindow"/>).
/// </summary>
public sealed record RestHistoryInput(
    RestSettings Settings,
    Guid PersonId,
    DateOnly LastNight,
    int Nights,
    DateTimeOffset Now,
    IReadOnlyDictionary<DateOnly, DateTimeOffset> MorningAnswers,
    IEnumerable<RestEvent> Events);

/// <summary>
/// One night of the history: the one-night estimate as <see cref="RestEstimator"/> returns it, whether a work window of the
/// person overlaps the night window, and whether the night is counted in the summaries.
/// </summary>
public sealed record RestHistoryNight(RestNight Estimate, bool WorkOverlap, bool Counted)
{
    /// <summary><see cref="RestConfidence.Low"/> when any part is low, <see cref="RestConfidence.Normal"/> otherwise, <c>null</c> without parts.</summary>
    public RestConfidence? Confidence => Estimate.Parts.Count == 0
        ? null
        : Estimate.Parts.Any(part => part.Confidence == RestConfidence.Low) ? RestConfidence.Low : RestConfidence.Normal;
}

/// <summary>The 25th percentile, median and 75th percentile of the nightly rested minutes of a group, each rounded to 5 minutes.</summary>
public sealed record RestMinutesRange(int P25, int Median, int P75);

/// <summary>A group of nights: how many were counted and, from <see cref="RestHistoryBuilder.MinimumNights"/> on, their typical range.</summary>
public sealed record RestGroupSummary(int CountedNights, RestMinutesRange? RestedMinutes);

/// <summary>Nights that start Monday to Friday against nights that start Saturday or Sunday (local date the night starts).</summary>
public sealed record RestWeekSplit(RestGroupSummary Weekday, RestGroupSummary Weekend);

/// <summary>The share (0 to 1, two decimals) of counted nights in which the person is estimated asleep during a local hour.</summary>
public sealed record RestHourShare(int Hour, double Share);

/// <summary>24 local hours from the hour the night window starts; <see cref="Hours"/> is empty below <see cref="RestHistoryBuilder.MinimumNights"/>.</summary>
public sealed record RestTypicalNight(int CountedNights, IReadOnlyList<RestHourShare> Hours);

/// <summary>The values the history used, so the web can say how it was computed.</summary>
public sealed record RestHistoryConstants(
    int FallAsleepMinutes,
    int WakeLeadMinutes,
    int MinimumNights,
    int MinutesRounding,
    int ShareDecimals,
    int AsleepMinutesPerHour);

/// <summary>
/// The person's own rest over past nights (docs/design/41-caregiver-rest.md "History"). Never stored; no total for the family,
/// no score, no target, no comparison: only the person's own estimates and their typical range.
/// </summary>
public sealed record RestHistory(
    RestStatus Status,
    int NightsRequested,
    IReadOnlyList<RestHistoryNight> Nights,
    RestWeekSplit WeekdayWeekend,
    RestTypicalNight TypicalNight,
    RestHistoryConstants Constants);

/// <summary>
/// Builds <see cref="RestHistory"/> from the one-night estimator (no rule of R1 to R6 is repeated here). Pure: no I/O, no
/// clock. A night is counted in the summaries when its estimate is <see cref="RestStatus.Ok"/>, every part has an end and no
/// work window overlaps its night window; such a night's rested minutes are the sum of its parts.
/// </summary>
public static class RestHistoryBuilder
{
    /// <summary>Below this many counted nights a group (and the typical night) gives only its count.</summary>
    public const int MinimumNights = 4;

    /// <summary>Rested minutes are rounded to the nearest multiple of this (halves away from zero).</summary>
    public const int MinutesRounding = 5;

    /// <summary>Shares are rounded to this many decimals (halves away from zero).</summary>
    public const int ShareDecimals = 2;

    /// <summary>A person counts as asleep during an hour when the estimate covers at least this many minutes of it.</summary>
    public const int AsleepMinutesPerHour = 30;

    public const int HoursPerNight = 24;

    /// <summary>The allowed window lengths, in nights.</summary>
    public static IReadOnlyList<int> AllowedNights { get; } = [14, 28];

    public static bool IsAllowedNights(int nights) => AllowedNights.Contains(nights);

    /// <summary>The latest local date (in the person's zone) whose night window has ended at or before <paramref name="now"/>.</summary>
    public static DateOnly LastFinishedNight(RestSettings settings, DateTimeOffset now)
    {
        var zone = RestCalendar.Zone(settings);
        var night = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).DateTime);
        while (RestCalendar.NightWindow(settings, night).End > now)
        {
            night = night.AddDays(-1);
        }

        return night;
    }

    public static RestHistory Build(RestHistoryInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (!IsAllowedNights(input.Nights))
        {
            throw new ArgumentOutOfRangeException(nameof(input), input.Nights, "Nights must be 14 or 28.");
        }

        var settings = input.Settings;
        var constants = new RestHistoryConstants(
            settings.FallAsleepMinutes, settings.WakeLeadMinutes, MinimumNights, MinutesRounding, ShareDecimals, AsleepMinutesPerHour);
        if (!settings.Enabled)
        {
            return new RestHistory(RestStatus.Disabled, input.Nights, [], Split([]), new RestTypicalNight(0, []), constants);
        }

        var events = input.Events.ToList();
        var nights = NightDates(input).Select(night => Night(input, events, night)).ToList();
        var counted = nights.Where(night => night.Counted).ToList();
        return new RestHistory(RestStatus.Ok, input.Nights, nights, Split(counted), Typical(settings, counted), constants);
    }

    private static IEnumerable<DateOnly> NightDates(RestHistoryInput input) =>
        Enumerable.Range(0, input.Nights).Select(offset => input.LastNight.AddDays(offset - input.Nights + 1));

    private static RestHistoryNight Night(RestHistoryInput input, IReadOnlyList<RestEvent> events, DateOnly night)
    {
        var window = RestCalendar.EventWindow(input.Settings, night);
        var answer = input.MorningAnswers.TryGetValue(night, out var upAt) ? upAt : (DateTimeOffset?)null;
        var slice = events.Where(item => Overlaps(item, window));
        var estimate = RestEstimator.Estimate(new RestInput(input.Settings, input.PersonId, night, input.Now, answer, slice));
        var workOverlap = WorkOverlaps(input.Settings, night);
        var counted = estimate.Status == RestStatus.Ok && !workOverlap && estimate.Parts.All(part => part.End is not null);
        return new RestHistoryNight(estimate, workOverlap, counted);
    }

    /// <summary>The same overlap the one-night estimate reads its events with (started before the end; running, ended after the start or started at or after it).</summary>
    private static bool Overlaps(RestEvent item, RestInterval window) =>
        item.StartedAt < window.End && (item.EndedAt is null || item.EndedAt > window.Start || item.StartedAt >= window.Start);

    private static bool WorkOverlaps(RestSettings settings, DateOnly night)
    {
        var window = RestCalendar.NightWindow(settings, night);
        return RestCalendar.WorkWindows(settings, night).Any(work => work.Overlaps(window));
    }

    private static double RestedMinutes(RestHistoryNight night) =>
        night.Estimate.Parts.Sum(part => (part.End!.Value - part.Start).TotalMinutes);

    private static RestWeekSplit Split(IReadOnlyList<RestHistoryNight> counted)
    {
        var weekend = counted.Where(night => IsWeekend(night.Estimate.Night)).ToList();
        var weekday = counted.Where(night => !IsWeekend(night.Estimate.Night)).ToList();
        return new RestWeekSplit(Group(weekday), Group(weekend));
    }

    private static bool IsWeekend(DateOnly night) => night.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;

    private static RestGroupSummary Group(IReadOnlyList<RestHistoryNight> nights)
    {
        if (nights.Count < MinimumNights)
        {
            return new RestGroupSummary(nights.Count, null);
        }

        var minutes = nights.Select(RestedMinutes).Order().ToList();
        var range = new RestMinutesRange(
            RoundMinutes(Percentile(minutes, 0.25)),
            RoundMinutes(Percentile(minutes, 0.5)),
            RoundMinutes(Percentile(minutes, 0.75)));
        return new RestGroupSummary(nights.Count, range);
    }

    /// <summary>Linear interpolation between the closest ranks (the "inclusive" method, as a spreadsheet's PERCENTILE.INC).</summary>
    private static double Percentile(IReadOnlyList<double> sorted, double fraction)
    {
        var rank = fraction * (sorted.Count - 1);
        var lower = (int)Math.Floor(rank);
        var upper = (int)Math.Ceiling(rank);
        return sorted[lower] + ((sorted[upper] - sorted[lower]) * (rank - lower));
    }

    private static int RoundMinutes(double minutes) =>
        (int)(Math.Round(minutes / MinutesRounding, MidpointRounding.AwayFromZero) * MinutesRounding);

    private static RestTypicalNight Typical(RestSettings settings, IReadOnlyList<RestHistoryNight> counted)
    {
        if (counted.Count < MinimumNights)
        {
            return new RestTypicalNight(counted.Count, []);
        }

        var zone = RestCalendar.Zone(settings);
        var first = settings.NightStart.Hour;
        var hours = Enumerable.Range(0, HoursPerNight)
            .Select(offset => new RestHourShare((first + offset) % HoursPerNight, Share(zone, first, offset, counted)))
            .ToList();
        return new RestTypicalNight(counted.Count, hours);
    }

    private static double Share(TimeZoneInfo zone, int firstHour, int offset, IReadOnlyList<RestHistoryNight> counted)
    {
        var asleep = counted.Count(night => AsleepDuring(night, HourSlot(zone, night.Estimate.Night, firstHour, offset)));
        return Math.Round((double)asleep / counted.Count, ShareDecimals, MidpointRounding.AwayFromZero);
    }

    /// <summary>One real hour starting at the local wall-clock hour <paramref name="offset"/> hours after the night's first hour.</summary>
    private static RestInterval HourSlot(TimeZoneInfo zone, DateOnly night, int firstHour, int offset)
    {
        var date = firstHour + offset < HoursPerNight ? night : night.AddDays(1);
        var start = RestCalendar.ToUtc(zone, date, new TimeOnly((firstHour + offset) % HoursPerNight, 0));
        return new RestInterval(start, start.AddHours(1));
    }

    private static bool AsleepDuring(RestHistoryNight night, RestInterval slot) =>
        night.Estimate.Parts.Sum(part => new RestInterval(part.Start, part.End!.Value).OverlapWith(slot).TotalMinutes) >= AsleepMinutesPerHour;
}
