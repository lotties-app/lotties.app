namespace Lotties.Domain.Predictions;

/// <summary>Age bands whose rhythms are measured separately when there is enough data.</summary>
public enum AgeBand
{
    /// <summary>Under 3 months.</summary>
    UnderThreeMonths,

    /// <summary>3 to under 6 months.</summary>
    ThreeToSixMonths,

    /// <summary>6 to under 12 months.</summary>
    SixToTwelveMonths,

    /// <summary>12 months and older.</summary>
    TwelveMonthsPlus,
}

/// <summary>Age band rules.</summary>
public static class AgeBands
{
    private const int ThreeMonths = 3;
    private const int SixMonths = 6;
    private const int TwelveMonths = 12;
    private const int MonthsPerYear = 12;

    /// <summary>The band of a baby born on <paramref name="birthDate"/> on <paramref name="date"/>; dates before birth count as newborn.</summary>
    public static AgeBand At(DateOnly birthDate, DateOnly date) => CompletedMonths(birthDate, date) switch
    {
        < ThreeMonths => AgeBand.UnderThreeMonths,
        < SixMonths => AgeBand.ThreeToSixMonths,
        < TwelveMonths => AgeBand.SixToTwelveMonths,
        _ => AgeBand.TwelveMonthsPlus,
    };

    /// <summary>Short label such as <c>3-6m</c>.</summary>
    public static string Label(AgeBand band) => band switch
    {
        AgeBand.UnderThreeMonths => "0-3m",
        AgeBand.ThreeToSixMonths => "3-6m",
        AgeBand.SixToTwelveMonths => "6-12m",
        AgeBand.TwelveMonthsPlus => "12m+",
        _ => throw new ArgumentOutOfRangeException(nameof(band), band, "Unknown age band."),
    };

    private static int CompletedMonths(DateOnly birthDate, DateOnly date)
    {
        var months = ((date.Year - birthDate.Year) * MonthsPerYear) + date.Month - birthDate.Month;
        return date.Day < birthDate.Day ? months - 1 : months;
    }
}
