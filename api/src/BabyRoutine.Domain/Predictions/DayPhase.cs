namespace BabyRoutine.Domain.Predictions;

/// <summary>Part of the local day, used to measure night rhythms apart from day rhythms.</summary>
public enum DayPhase
{
    Day,
    Night,
}

/// <summary>Day/night rules.</summary>
public static class DayPhases
{
    /// <summary>The phase of <paramref name="instant"/> in local time (<paramref name="localOffset"/>).</summary>
    public static DayPhase Of(DateTimeOffset instant, TimeSpan localOffset, PredictionOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var localTime = TimeOnly.FromTimeSpan(instant.ToOffset(localOffset).TimeOfDay);
        return localTime.IsBetween(options.NightStartsAt, options.NightEndsAt) ? DayPhase.Night : DayPhase.Day;
    }

    /// <summary>Lower-case label: <c>day</c> or <c>night</c>.</summary>
    public static string Label(DayPhase phase) => phase == DayPhase.Night ? "night" : "day";
}
