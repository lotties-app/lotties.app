using Lotties.Domain.Predictions;

namespace Lotties.Domain.CryReasons;

/// <summary>The web's <c>cryAgeBand</c>: 6 months and over, 3 to 6, under 6 weeks (42 days) newborn, else 6 weeks to 3 months.</summary>
public static class CryAgeBands
{
    /// <summary>Used without a (valid) birth date.</summary>
    public const CryAgeBand Default = CryAgeBand.Weeks6to3m;

    private const int SixMonths = 6;
    private const int ThreeMonths = 3;
    private const int NewbornDays = 42;

    /// <summary>The band on the local date <paramref name="today"/>; <see cref="Default"/> for a birth date in the future.</summary>
    public static CryAgeBand At(DateOnly birthDate, DateOnly today)
    {
        if (today < birthDate)
        {
            return Default;
        }

        var months = AgeBands.CompletedMonths(birthDate, today);
        return months switch
        {
            >= SixMonths => CryAgeBand.Months6plus,
            >= ThreeMonths => CryAgeBand.Months3to6,
            _ => today.DayNumber - birthDate.DayNumber < NewbornDays ? CryAgeBand.Newborn : CryAgeBand.Weeks6to3m,
        };
    }
}
