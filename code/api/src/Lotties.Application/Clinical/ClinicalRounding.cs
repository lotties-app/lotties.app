using System.Globalization;
using Lotties.Domain.Clinical;

namespace Lotties.Application.Clinical;

/// <summary>How the doctor's views round the summaries: minutes to whole numbers, averages per day to one decimal.</summary>
internal static class ClinicalRounding
{
    private const double MillisecondsPerMinute = 60_000d;

    /// <summary>Whole minutes of a length in milliseconds (half up, like the parents' app).</summary>
    public static int Minutes(double milliseconds) => (int)ClinicalStatistics.RoundHalfUp(milliseconds / MillisecondsPerMinute);

    public static int? Minutes(double? milliseconds) => milliseconds is { } value ? Minutes(value) : null;

    /// <summary>A value rounded to one decimal (half up, through <see cref="decimal"/> so binary noise such as 2.9499999999999997 does not flip a half).</summary>
    public static double OneDecimal(double value) => (double)Math.Round((decimal)value, 1, MidpointRounding.AwayFromZero);

    public static double? OneDecimal(double? value) => value is { } number ? OneDecimal(number) : null;

    /// <summary><c>HH:mm</c> of a clock time.</summary>
    public static string Clock(TimeOnly time) => time.ToString("HH:mm", CultureInfo.InvariantCulture);

    public static string? Clock(TimeOnly? time) => time is { } value ? Clock(value) : null;
}
