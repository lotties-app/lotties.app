using Lotties.Domain.AgeNorms;
using Lotties.Domain.Clinical;
using Lotties.Domain.Tests.AgeNorms;
using static Lotties.Domain.Tests.Clinical.ClinicalFixtures;

namespace Lotties.Domain.Tests.Clinical;

/// <summary>
/// The age-aware feed-gap cut-off (docs/design/28-age-norms.md section 15.2): 8 hours under 6 months and without a usable
/// norm; from 6 months the published night length's high end, between 8 and 14 hours. The shared vectors are in
/// <see cref="AgeNormsVectorTests"/>; these are the before/after golden cases of the feeding average.
/// </summary>
public sealed class FeedGapLimitTests
{
    private static readonly DateTimeOffset NowJan10Noon = Brazil.Local(1, 10, 12);

    /// <summary>Gaps 4 h, 6 h, 8 h, 10 h (starts on 2026-01-09 at 02:00), 3 h.</summary>
    private static FeedObservation[] Feeds() =>
    [
        new(Brazil.Local(1, 8, 8), "breast"),
        new(Brazil.Local(1, 8, 12), "bottle", 120),
        new(Brazil.Local(1, 8, 18), "bottle", 90),
        new(Brazil.Local(1, 9, 2), "solid"),
        new(Brazil.Local(1, 9, 12), "bottle", 60),
        new(Brazil.Local(1, 9, 15), "bottle"),
    ];

    private static double? AverageGapHours(FeedGapLimit? limit) =>
        FeedingSummaries.Summarize(Feeds(), Window(Brazil, (1, 8), (1, 10), NowJan10Noon), limit).AverageIntervalMs / 3_600_000d;

    [Fact]
    public void Summarize_WithoutALimit_KeepsTheEightHourCutOff()
    {
        Assert.Equal((4 + 6 + 8 + 3) / 4d, AverageGapHours(null));
        Assert.Equal((4 + 6 + 8 + 3) / 4d, AverageGapHours(FeedGapLimit.Fixed));
        Assert.Equal(TimeSpan.FromHours(8), FeedingSummaries.MaxFeedGap);
    }

    [Fact]
    public void Summarize_UnderSixMonths_IsUnchangedWithTheNorms()
    {
        // 100 days old on 2026-01-09: before 4+6+8+3 over 4, after the same.
        Assert.Equal((4 + 6 + 8 + 3) / 4d, AverageGapHours(new FeedGapLimit(ShippedAgeNorms.Set, new DateOnly(2025, 10, 1))));
    }

    [Fact]
    public void Summarize_AtOneYear_KeepsARealTenHourNight()
    {
        // 366 days old on 2026-01-09: the 10 h night counts (cut-off 13.6 h, night_sleep_hours.all.365-548).
        Assert.Equal((4 + 6 + 8 + 10 + 3) / 5d, AverageGapHours(new FeedGapLimit(ShippedAgeNorms.Set, new DateOnly(2025, 1, 8))));
    }

    [Fact]
    public void Summarize_SevenMonthsOld_StaysAtEightHoursWhileTheOnlyNormsNeedReview()
    {
        Assert.Equal((4 + 6 + 8 + 3) / 4d, AverageGapHours(new FeedGapLimit(ShippedAgeNorms.Set, new DateOnly(2025, 6, 1))));
    }

    [Fact]
    public void Summarize_TheDateTheGapStartsOnDecidesTheAge()
    {
        // 365 days old on 2026-01-09 (the 10 h gap starts that day at 02:00): counts; one day younger it would not.
        Assert.Equal((4 + 6 + 8 + 10 + 3) / 5d, AverageGapHours(new FeedGapLimit(ShippedAgeNorms.Set, new DateOnly(2025, 1, 9))));
        Assert.Equal((4 + 6 + 8 + 3) / 4d, AverageGapHours(new FeedGapLimit(ShippedAgeNorms.Set, new DateOnly(2025, 1, 10))));
    }

    [Theory]
    [InlineData(20, 14)]
    [InlineData(6, 8)]
    [InlineData(10.5, 10.5)]
    public void For_KeepsTheCutOffBetweenEightAndFourteenHours(double publishedHigh, double expectedHours)
    {
        var norms = WithNightHigh((decimal)publishedHigh);

        Assert.Equal(expectedHours, FeedGapLimit.For(norms, 400).TotalHours, 6);
    }

    [Fact]
    public void For_UnknownAge_IsEightHours()
    {
        Assert.Equal(FeedGapLimit.Default, FeedGapLimit.For(ShippedAgeNorms.Set, null));
        Assert.Equal(FeedGapLimit.Default, FeedGapLimit.For(ShippedAgeNorms.Set, -3));
        Assert.Equal(FeedGapLimit.Default, new FeedGapLimit(ShippedAgeNorms.Set, null).On(new DateOnly(2026, 1, 9)));
    }

    private static AgeNormSet WithNightHigh(decimal high)
    {
        var set = ShippedAgeNorms.Set;
        var norms = set.Norms.Select(norm => norm.Id == "night_sleep_hours.all.365-548" ? norm with { High = high } : norm).ToArray();
        return new AgeNormSet(set.SchemaVersion, set.GeneratedAt, set.Purpose, set.Units, set.Populations, set.RangeKinds, set.TypicalKinds, set.Metrics, set.Sources, norms);
    }
}
