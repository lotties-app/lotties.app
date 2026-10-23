namespace Lotties.Domain.Clinical;

/// <summary>The averaging rules of the parents' Insights (<c>days.ts</c>), pure.</summary>
public static class ClinicalStatistics
{
    /// <summary>
    /// The days that averages are taken over: days with data, without today (it is not over yet) unless today is the only one.
    /// </summary>
    public static IReadOnlyList<TDay> CompletedDaysWithData<TDay>(IEnumerable<TDay> days, Func<TDay, bool> hasData, Func<TDay, DateOnly> dateOf, DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(days);
        ArgumentNullException.ThrowIfNull(hasData);
        ArgumentNullException.ThrowIfNull(dateOf);
        var withData = days.Where(hasData).ToArray();
        var finished = withData.Where(day => dateOf(day) != today).ToArray();
        return finished.Length > 0 ? finished : withData;
    }

    /// <summary>The mean of the values, or <c>null</c> without any.</summary>
    public static double? Mean(IReadOnlyCollection<double> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        return values.Count == 0 ? null : values.Sum() / values.Count;
    }

    /// <summary>The median of the values (the mean of the two middle ones for an even count), or <c>null</c> without any.</summary>
    public static double? Median(IReadOnlyCollection<double> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        if (values.Count == 0)
        {
            return null;
        }

        var sorted = values.Order().ToArray();
        var middle = sorted.Length / 2;
        return sorted.Length % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    /// <summary>Rounds half up like JavaScript's <c>Math.round</c> does for the positive values the summaries hold.</summary>
    public static double RoundHalfUp(double value) => Math.Floor(value + 0.5);
}
