namespace Lotties.Domain.Patterns;

/// <summary>
/// Circular mean (whole minute of the day) and circular standard deviation (minutes, <c>sqrt(-2 ln R)</c>) of times of
/// day on a 24-hour circle, so 23:50 and 00:10 are 20 minutes apart. Shared by <see cref="RecurringTimeOfDayPattern"/>
/// and the rhythm (docs/design/48-baby-rhythm.md). The spread is infinite when the times cancel out.
/// </summary>
internal sealed record CircularSummary(int Mean, double Spread)
{
    public const int MinutesPerDay = 24 * 60;

    /// <param name="minutes">Minutes of the day (0 to 1439); at least one.</param>
    public static CircularSummary Of(IReadOnlyList<int> minutes)
    {
        var angles = minutes.Select(minute => minute * 2 * Math.PI / MinutesPerDay).ToArray();
        var sine = angles.Sum(Math.Sin);
        var cosine = angles.Sum(Math.Cos);
        var resultant = Math.Min(1.0, Math.Sqrt((sine * sine) + (cosine * cosine)) / angles.Length);
        var mean = (int)Math.Round(Math.Atan2(sine, cosine) * MinutesPerDay / (2 * Math.PI), MidpointRounding.AwayFromZero);
        var spread = resultant <= 0 ? double.PositiveInfinity : Math.Sqrt(-2 * Math.Log(resultant)) * MinutesPerDay / (2 * Math.PI);
        return new CircularSummary(Modulo(mean), spread);
    }

    /// <summary>Minutes between two times of day on the 24-hour circle (0 to 720).</summary>
    public static int Distance(int first, int second)
    {
        var apart = Math.Abs(first - second) % MinutesPerDay;
        return Math.Min(apart, MinutesPerDay - apart);
    }

    /// <summary>The minute of the day of any whole minute count (negative or past midnight wrap around).</summary>
    public static int Modulo(int minute) => ((minute % MinutesPerDay) + MinutesPerDay) % MinutesPerDay;
}
