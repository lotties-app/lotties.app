namespace Lotties.Domain.EventTypes;

/// <summary>
/// Keys and option values of the optional sleep detail fields of the built-in <c>sleep</c> type (how the sleep went),
/// shown only for the <c>nap</c> and <c>night</c> kinds. All are optional; none is ever required.
/// </summary>
public static class SleepDetailFields
{
    public const string HowSlept = "how_slept";
    public const string FallAsleep = "fall_asleep";
    public const string TimeToFallAsleepMinutes = "time_to_fall_asleep_minutes";
    public const string HowWoke = "how_woke";
    public const string MoodOnWake = "mood_on_wake";

    /// <summary>Largest accepted <see cref="TimeToFallAsleepMinutes"/> (four hours).</summary>
    public const int MaxTimeToFallAsleepMinutes = 240;

    /// <summary>The kinds the details apply to.</summary>
    public static IReadOnlyList<string> Kinds { get; } = Array.AsReadOnly(new[] { "nap", "night" });

    public static IReadOnlyList<string> HowSleptOptions { get; } = Array.AsReadOnly(new[] { "in_bed", "nursing", "held", "next_to_me", "bottle", "stroller", "car", "swing", "other" });

    public static IReadOnlyList<string> FallAsleepOptions { get; } = Array.AsReadOnly(new[] { "easy", "took_long", "fussy" });

    public static IReadOnlyList<string> HowWokeOptions { get; } = Array.AsReadOnly(new[] { "naturally", "woken" });

    public static IReadOnlyList<string> MoodOptions { get; } = Array.AsReadOnly(new[] { "good", "neutral", "bad" });

    /// <summary>Every detail key, in definition order.</summary>
    public static IReadOnlyList<string> All { get; } = Array.AsReadOnly(new[] { HowSlept, FallAsleep, TimeToFallAsleepMinutes, HowWoke, MoodOnWake });
}
