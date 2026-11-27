using Lotties.Domain.CommunityInsights;
using static Lotties.Domain.Tests.CommunityInsights.CommunityFixtures;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// A kind of sleep a family does not log is missing, not zero (docs/design/34-community-insights.md section 5.3): a routine day with no
/// night (<c>NightSleepMinutes</c> null) or no nap (<c>NapsPerDay</c> and <c>DaySleepMinutes</c> null) gives no sample of that
/// statistic, so the day cap, the 4-cell bound, k, the families and dominance of each statistic are computed only over the babies and
/// days that really contribute to it, by construction.
/// </summary>
public sealed class CommunityMissingSleepTests
{
    private const string Night = "night_sleep_minutes";

    private const string Naps = "naps_per_day";

    private const string DaySleep = "day_sleep_minutes";

    /// <summary>20 babies from 20 families, of whom 5 log only naps: naps reach k, nights do not (15 babies).</summary>
    [Fact]
    public void BabiesWhoLogOnlyNaps_DoNotCountTowardNightK()
    {
        var both = NewBabies(15, 15);
        var napsOnly = NewBabies(5, 5);
        var routines = Days(both, night: 600m).Concat(Days(napsOnly, night: null)).ToArray();

        var release = Run(Input(routines: routines));

        Assert.Empty(CellsOf(release, Night));
        Assert.Single(CellsOf(release, Naps));
        Assert.Single(CellsOf(release, DaySleep));
    }

    /// <summary>Adding babies who log only naps leaves every night cell exactly as it was (exact noise, same cap key).</summary>
    [Fact]
    public void BabiesWhoLogOnlyNaps_DoNotChangeTheNightValues()
    {
        var both = NewBabies(25, 25);
        var napsOnly = NewBabies(5, 5);
        var nights = Days(both, night: null, nightOf: index => 480m + (index * 10)).ToArray();

        var alone = Run(Input(routines: nights));
        var withNapsOnly = Run(Input(routines: [.. nights, .. Days(napsOnly, night: null, napsMinutes: 200m)]));

        var expected = Assert.Single(CellsOf(alone, Night));
        var actual = Assert.Single(CellsOf(withNapsOnly, Night));
        Assert.Equal(expected.Band, actual.Band);
        Assert.Equal(expected.Babies, actual.Babies);
        Assert.Equal(expected.Outputs.OrderBy(pair => pair.Key), actual.Outputs.OrderBy(pair => pair.Key));
    }

    /// <summary>Babies who log only nights publish no naps and no day sleep at all (never a band of zero naps).</summary>
    [Fact]
    public void BabiesWhoLogOnlyNights_PublishNoNapOrDaySleepCell()
    {
        var nightsOnly = NewBabies(25, 25);
        var routines = nightsOnly.SelectMany(baby => Enumerable.Range(0, 10).Select(day =>
            new CommunityRoutineDay(baby.Baby, baby.Family, 10, WindowStart.AddDays(day), 600m, null, null))).ToArray();

        var release = Run(Input(routines: routines));

        Assert.Single(CellsOf(release, Night));
        Assert.Empty(CellsOf(release, Naps));
        Assert.Empty(CellsOf(release, DaySleep));
    }

    /// <summary>
    /// Ten routine days per baby at 10 weeks. <paramref name="night"/> null and no <paramref name="nightOf"/>: the baby logs only naps
    /// (2 naps, <paramref name="napsMinutes"/> of day sleep); with <paramref name="nightOf"/>: only nights of that length per baby.
    /// </summary>
    private static IEnumerable<CommunityRoutineDay> Days(IReadOnlyList<TestBaby> babies, decimal? night, Func<int, decimal>? nightOf = null, decimal napsMinutes = 120m) =>
        babies.SelectMany((baby, index) => Enumerable.Range(0, 10).Select(day => nightOf is null
            ? new CommunityRoutineDay(baby.Baby, baby.Family, 10, WindowStart.AddDays(day), night, 2m, napsMinutes)
            : new CommunityRoutineDay(baby.Baby, baby.Family, 10, WindowStart.AddDays(day), nightOf(index), null, null)));
}
