namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// The fixed values of each catalog band dimension (docs/design/34-community-insights.md section 5 "No repeated queries": age band,
/// feeding kind for bottles, part of day for crying, the routine metric). A value outside these lists is never read.
/// </summary>
public static class CommunityDimensions
{
    public const string PartOfDay = "part_of_day";

    public const string BottleFeedingType = "bottle_feeding_type";

    public const string RoutineMetric = "routine_metric";

    private static readonly IReadOnlyList<string?> NoDimension = [null];

    private static readonly IReadOnlyDictionary<string, IReadOnlyList<string?>> Values = new Dictionary<string, IReadOnlyList<string?>>(StringComparer.Ordinal)
    {
        [PartOfDay] = [.. CommunityPartsOfDay.All],
        [BottleFeedingType] = ["formula", "breast_milk"],
        [RoutineMetric] = ["naps_per_day", "day_sleep_minutes", "night_sleep_minutes", "feeds_per_day", "diapers_per_day"],
    };

    /// <summary>The values of <paramref name="dimension"/> in their fixed order; a single null for a statistic with no dimension.</summary>
    public static IReadOnlyList<string?> ValuesOf(string? dimension) =>
        dimension is null ? NoDimension : Values.GetValueOrDefault(dimension, []);

    /// <summary>Whether <paramref name="dimension"/> is a known dimension (a statistic with none is always fine).</summary>
    public static bool IsKnown(string? dimension) => dimension is null || Values.ContainsKey(dimension);
}

/// <summary>Parts of the local day of a crying spell (section 4): morning 06-12, afternoon 12-18, evening 18-24, night 00-06.</summary>
public static class CommunityPartsOfDay
{
    public const string Morning = "morning";

    public const string Afternoon = "afternoon";

    public const string Evening = "evening";

    public const string Night = "night";

    public static readonly IReadOnlyList<string> All = [Morning, Afternoon, Evening, Night];

    /// <summary>The part of day of a local clock hour (0-23); never an exact time.</summary>
    public static string FromLocalHour(int hour) => hour switch
    {
        < 0 or > 23 => throw new ArgumentOutOfRangeException(nameof(hour), hour, "A local hour is 0 to 23."),
        < 6 => Night,
        < 12 => Morning,
        < 18 => Afternoon,
        _ => Evening,
    };
}

/// <summary>
/// The causes of the crying statistic (docs/design/27-cry-reasons.md sections 5 and 8): what helped a spell, mapped to a cause, and
/// the cause the app suggested first. <see cref="None"/> stands for "other" and "nothing" (and for an unknown answer).
/// </summary>
public static class CommunityCryCauses
{
    public const string None = "none";

    /// <summary>The five causes the app can suggest (<c>suggested_cause</c>), in the web's <c>CRY_CAUSES</c> order.</summary>
    public static readonly IReadOnlyList<string> Suggestable = ["hunger", "sleepy", "diaper", "gas", "comfort"];

    /// <summary>Every cause a spell can be helped by: the suggestable ones and <see cref="None"/>.</summary>
    public static readonly IReadOnlyList<string> Helped = [.. Suggestable, None];

    private static readonly IReadOnlyDictionary<string, string> CauseOfWhatHelped = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["feeding"] = "hunger",
        ["sleep"] = "sleepy",
        ["diaper_change"] = "diaper",
        ["burping"] = "gas",
        ["massage"] = "gas",
        ["rocking"] = "comfort",
        ["pacifier"] = "comfort",
        ["holding"] = "comfort",
        ["other"] = None,
        ["nothing"] = None,
    };

    /// <summary>The cause a <c>what_helped</c> option stands for (design 27 section 5); an unknown option is <see cref="None"/>.</summary>
    public static string FromWhatHelped(string? option) =>
        option is not null && CauseOfWhatHelped.TryGetValue(option, out var cause) ? cause : None;
}
