using Lotties.Domain.CommunityInsights;
using static Lotties.Domain.Tests.CommunityInsights.CommunityFixtures;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// The pure aggregation core (<see cref="CommunityStatisticsAggregator"/>, docs/design/34-community-insights.md sections 5 and 5.1):
/// k babies and k families in every release (no hysteresis), one summary per baby, dominance, the coarse fallback with
/// complementary suppression, withdrawal, the budget and the fixed noise grid. Exact noise unless a test says otherwise.
/// </summary>
public sealed class CommunityStatisticsAggregatorTests
{
    private const int K = 20;

    [Fact]
    public void Aggregate_KBabiesFromKFamilies_IsPublished()
    {
        var release = Run(Input(tummy: TummyDays(NewBabies(K, K), ageWeeks: 100, withTummy: 15)));

        var cell = Assert.Single(CellsOf(release, Tummy));
        Assert.Equal(new CommunityBand(100, 104), cell.Band);
        Assert.Equal(0.75m, cell.Outputs[CommunityOutputs.ShareOfDaysWithAny]);
        Assert.Equal(CommunityGroupSize.Babies20To49, cell.Babies);
    }

    [Theory]
    [InlineData(K - 1, K - 1)]
    [InlineData(K - 2, K - 2)]
    [InlineData(K, K - 1)]
    [InlineData(K + 5, K - 1)]
    public void Aggregate_BelowKBabiesOrKFamilies_IsNeverPublished(int babies, int families)
    {
        var release = Run(Input(tummy: TummyDays(NewBabies(babies, families), ageWeeks: 100, withTummy: 5)));

        Assert.Empty(release.Cells);
    }

    [Fact]
    public void Aggregate_NoData_HasTheParametersAndNoCell()
    {
        var release = Run(Input());

        Assert.False(release.IsPlaceholder);
        Assert.Empty(release.Cells);
        Assert.Equal(
            [("bottle_ml_per_feed", 8m), (Tummy, 5m), ("naps_per_day", 8m), ("day_sleep_minutes", 8m), ("night_sleep_minutes", 8m), (Cry, 0.2m)],
            release.Statistics.Select(statistic => (statistic.Key, statistic.Epsilon)));
        Assert.All(release.Statistics, statistic => Assert.Equal(K, statistic.K));
    }

    [Fact]
    public void Aggregate_PublishesOnlyTheV1ShareOutputs_NeverAPercentile()
    {
        var babies = NewBabies(30, 30);
        var release = Run(Input(tummy: TummyDays(babies, 8, 10), spells: Spells(babies, 2, "hunger")));

        var names = release.Cells.SelectMany(cell => cell.Outputs.Keys).Distinct().Order(StringComparer.Ordinal).ToArray();
        string[] expected =
        [
            "share_helped_by_cause.comfort", "share_helped_by_cause.diaper", "share_helped_by_cause.gas", "share_helped_by_cause.hunger",
            "share_helped_by_cause.none", "share_helped_by_cause.sleepy", "share_of_days_with_any",
        ];
        Assert.Equal(expected, names);
        Assert.All(release.Cells, cell => Assert.Null(cell.Dimension));
    }

    [Fact]
    public void Aggregate_CryShares_AreTheMeanOfOneSummaryPerBaby()
    {
        // Ten babies with one spell helped by feeding; ten with three spells, one by feeding and two by sleep. One summary per baby:
        // hunger = (10 x 1 + 10 x 1/3) / 20, sleepy = (10 x 2/3) / 20, not the per-spell shares (20/40 and 20/40).
        var light = NewBabies(10, 10);
        var heavy = NewBabies(10, 10);
        var spells = Spells(light, 3, "hunger")
            .Concat(Spells(heavy, 3, "hunger"))
            .Concat(Spells(heavy, 3, "sleepy", day: 1))
            .Concat(Spells(heavy, 3, "sleepy", day: 2))
            .ToArray();

        var cell = Assert.Single(CellsOf(Run(Input(spells: spells)), Cry));

        Assert.Equal(new CommunityBand(0, 6), cell.Band);
        Assert.Null(cell.Dimension);
        Assert.Equal(0.667m, cell.Outputs["share_helped_by_cause.hunger"]);
        Assert.Equal(0.333m, cell.Outputs["share_helped_by_cause.sleepy"]);
        Assert.Equal(0m, cell.Outputs["share_helped_by_cause.gas"]);
    }

    [Fact]
    public void Aggregate_BabyAcrossTwoBands_WeighsOneInTotal()
    {
        // Every baby has one spell at 2 weeks and one at 8 weeks: half of her weight is in each cry band, and both cells still count
        // her as a distinct baby.
        var babies = NewBabies(K, K);
        var spells = Spells(babies, 2, "gas").Concat(Spells(babies, 8, "comfort", day: 42)).ToArray();

        var cells = CellsOf(Run(Input(spells: spells)), Cry);

        Assert.Equal([new CommunityBand(0, 6), new CommunityBand(6, 13)], cells.Select(cell => cell.Band).OrderBy(band => band.FromWeeks));
        Assert.Equal(1m, cells.Single(cell => cell.Band.FromWeeks == 0).Outputs["share_helped_by_cause.gas"]);
        Assert.Equal(1m, cells.Single(cell => cell.Band.FromWeeks == 6).Outputs["share_helped_by_cause.comfort"]);
    }

    [Fact]
    public void Aggregate_UnknownCause_IsNotRead()
    {
        var babies = NewBabies(K, K);
        var spells = Spells(babies, 7, "hunger").Concat(Spells(babies, 7, "teething")).Concat(Spells(babies, 7, "__proto__")).ToArray();

        var cell = Assert.Single(CellsOf(Run(Input(spells: spells)), Cry));

        Assert.Equal(1m, cell.Outputs["share_helped_by_cause.hunger"]);
    }

    [Fact]
    public void Aggregate_AgeOutsideTheGrid_IsNotRead()
    {
        var release = Run(Input(tummy: TummyDays(NewBabies(30, 30), ageWeeks: CommunityStatisticsValidator.AgeWeeksEnd, withTummy: 30)
            .Concat(TummyDays(NewBabies(30, 30), ageWeeks: -1, withTummy: 30)).ToArray()));

        Assert.Empty(release.Cells);
    }

    [Fact]
    public void Aggregate_TummyMinutes_AreClippedAndAddedPerDay()
    {
        var babies = NewBabies(K, K);
        var days = babies.Select(baby => new CommunityTummyTimeDay(baby.Baby, baby.Family, 100, FirstDay, -30m))
            .Concat(babies.Take(4).Select(baby => new CommunityTummyTimeDay(baby.Baby, baby.Family, 100, FirstDay, 45m)))
            .ToArray();

        var cell = Assert.Single(CellsOf(Run(Input(tummy: days)), Tummy));

        // -30 + 45 = 15 minutes for four babies; -30 clipped to 0 minutes for the other sixteen.
        Assert.Equal(0.2m, cell.Outputs[CommunityOutputs.ShareOfDaysWithAny]);
    }

    [Fact]
    public void Withdrawal_TheBabyDisappearsFromTheNextRun()
    {
        var others = NewBabies(K, K);
        var withdrawing = new TestBaby(Guid.NewGuid(), Guid.NewGuid());
        var othersSpells = Spells(others, 2, "hunger");
        var first = Run(Input(spells: [.. othersSpells, .. Spells([withdrawing], 2, "diaper")]));

        // The next run's population snapshot no longer holds her: none of her records is read.
        var next = Run(Input(spells: othersSpells));

        Assert.Equal(0.048m, Assert.Single(first.Cells).Outputs["share_helped_by_cause.diaper"]);
        Assert.Equal(0m, Assert.Single(next.Cells).Outputs["share_helped_by_cause.diaper"]);
        Assert.Equal(1m, Assert.Single(next.Cells).Outputs["share_helped_by_cause.hunger"]);
    }

    [Fact]
    public void Withdrawal_AtTheMinimum_RemovesTheCell_NoHysteresis()
    {
        var babies = NewBabies(K, K);

        var published = Run(Input(tummy: TummyDays(babies, 100, 10)));
        var afterOneWithdrawal = Run(Input(tummy: TummyDays([.. babies.Skip(1)], 100, 10)));

        Assert.Single(published.Cells);
        Assert.Empty(afterOneWithdrawal.Cells);
    }

    [Fact]
    public void Withdrawal_SameSeed_IsTheReleaseOfThePopulationWithoutHer()
    {
        var others = NewBabies(30, 30);
        var withdrawing = NewBabies(1, 1);
        var without = TummyDays(others, 100, 12);

        var afterWithdrawal = Run(Input(tummy: without), new SnappedLaplaceNoise(new SeededRandomSource(7)));
        var neverThere = Run(Input(tummy: without), new SnappedLaplaceNoise(new SeededRandomSource(7)));
        var withHer = Run(Input(tummy: [.. without, .. TummyDays(withdrawing, 100, 0, days: 14)]), new SnappedLaplaceNoise(new SeededRandomSource(7)));

        Assert.Equal(CommunityReleaseJson.Serialize(neverThere), CommunityReleaseJson.Serialize(afterWithdrawal));
        Assert.NotEqual(Assert.Single(withHer.Cells).Outputs[CommunityOutputs.ShareOfDaysWithAny], Assert.Single(afterWithdrawal.Cells).Outputs[CommunityOutputs.ShareOfDaysWithAny]);
    }

    [Fact]
    public void HeavyFamily_WeighsAsOneBaby_HoweverMuchItLogs()
    {
        var others = NewBabies(24, 24);
        var heavy = NewBabies(1, 1);
        var othersSpells = Spells(others, 9, "hunger");
        var oneSpell = Spells(heavy, 9, "gas");
        var thirtyDaysOfTenSpells = Enumerable.Range(0, 30)
            .SelectMany(day => Enumerable.Repeat(oneSpell[0] with { LocalDay = FirstDay.AddDays(day) }, 10))
            .ToArray();

        var light = Assert.Single(Run(Input(spells: [.. othersSpells, .. oneSpell])).Cells);
        var loud = Assert.Single(Run(Input(spells: [.. othersSpells, .. thirtyDaysOfTenSpells])).Cells);

        Assert.Equal(0.04m, light.Outputs["share_helped_by_cause.gas"]);
        Assert.Equal(light.Outputs["share_helped_by_cause.gas"], loud.Outputs["share_helped_by_cause.gas"]);
    }

    [Theory]
    [InlineData(7, true)]
    [InlineData(8, false)]
    public void Dominance_OneFamilyAboveAQuarterOfTheCell_IsSuppressed(int babiesOfOneOwner, bool published)
    {
        // A day care Owner with several babies among 30, the rest one baby per family.
        var owner = Guid.NewGuid();
        var babies = Enumerable.Range(0, babiesOfOneOwner).Select(_ => new TestBaby(Guid.NewGuid(), owner))
            .Concat(NewBabies(30 - babiesOfOneOwner, 30 - babiesOfOneOwner))
            .ToArray();

        var release = Run(Input(tummy: TummyDays(babies, 100, 10)));

        Assert.Equal(published, release.Cells.Count == 1);
    }

    [Fact]
    public void CoarseFallback_CoversAFineCellBelowK_WithComplementarySuppression()
    {
        // Weeks 0, 1 and 2 have 25 babies each, week 3 only 5: the coarse cell 0-4 is published for week 3. Weeks 0-4 minus the
        // published fine cells must keep k, so the smallest published fine cell (week 0, the first of equal size) joins it.
        var bands = Run(Input(tummy: ThreeFullWeeksAndOneThin())).Cells.Select(cell => cell.Band).OrderBy(band => band.FromWeeks).ThenBy(band => band.ToWeeks);

        Assert.Equal([new CommunityBand(0, 4), new CommunityBand(1, 2), new CommunityBand(2, 3)], bands);
    }

    [Fact]
    public void CoarseFallback_RemainderNeedsTwenty_NotEighteen()
    {
        // Weeks 0 and 1 have 25 babies each, weeks 2 and 3 nine each: the remainder of 0-4 without the fine cells is 18 babies, which
        // the former hysteresis minimum would have let through; the smallest fine cell must join it to reach 20.
        var days = TummyDays(NewBabies(25, 25), 0, 10)
            .Concat(TummyDays(NewBabies(25, 25), 1, 10))
            .Concat(TummyDays(NewBabies(9, 9), 2, 5))
            .Concat(TummyDays(NewBabies(9, 9), 3, 5))
            .ToArray();

        var bands = Run(Input(tummy: days)).Cells.Select(cell => cell.Band).OrderBy(band => band.FromWeeks).ThenBy(band => band.ToWeeks);

        Assert.Equal([new CommunityBand(0, 4), new CommunityBand(1, 2)], bands);
    }

    [Fact]
    public void CoarseFallback_NotPublishedWhenTheWholeCoarseCellFails()
    {
        var days = Enumerable.Range(0, 4).SelectMany(week => TummyDays(NewBabies(4, 4), week, 2)).ToArray();

        Assert.Empty(Run(Input(tummy: days)).Cells);
    }

    [Fact]
    public void CoarseFallback_NotPublishedWhenEveryFineCellIs()
    {
        var days = Enumerable.Range(0, 4).SelectMany(week => TummyDays(NewBabies(K, K), week, 2)).ToArray();

        var bands = Run(Input(tummy: days)).Cells.Select(cell => cell.Band.Weeks);

        Assert.All(bands, weeks => Assert.Equal(1, weeks));
    }

    [Fact]
    public void CoarseFallback_IsReadForAnAgeWithoutAFineCell()
    {
        var release = Run(Input(tummy: ThreeFullWeeksAndOneThin()));

        Assert.Equal(new CommunityBand(0, 4), release.CellFor(Tummy, 3, null)?.Band);
        Assert.Equal(new CommunityBand(1, 2), release.CellFor(Tummy, 1, null)?.Band);
        Assert.Null(release.CellFor(Tummy, 30, null));
    }

    [Fact]
    public void Budget_IsTheStatisticsEpsilonPerRelease_AndTheNoiseFollowsTheFixedGrid()
    {
        var empty = new RecordingNoise();
        var full = new RecordingNoise();
        var babies = NewBabies(40, 30);
        CommunityStatisticsAggregator.Aggregate(Input(), empty);
        CommunityStatisticsAggregator.Aggregate(Input(tummy: TummyDays(babies, 5, 12, days: 3), spells: Spells(babies, 14, "sleepy")), full);

        // In catalog order. Percentile statistics: 26 four-week bands x their bins at scale 1/2 (epsilon 8 per release over at most
        // 4 cells per baby); tummy time: epsilon 5 on its one v1 output (scale 1/5) over 39 fine bands x 2 components; crying:
        // epsilon 0.2 on its one output (scale 1/0.2) over 4 cry bands x 6 causes. The same draws whatever the data.
        double[] expected =
        [
            .. Enumerable.Repeat(0.5, 26 * 21), .. Enumerable.Repeat(0.2, 39 * 2), .. Enumerable.Repeat(0.5, 26 * 17),
            .. Enumerable.Repeat(0.5, 26 * 25), .. Enumerable.Repeat(0.5, 26 * 33), .. Enumerable.Repeat(5.0, 4 * 6),
        ];
        Assert.Equal(expected, empty.Scales);
        Assert.Equal(expected, full.Scales);
    }

    [Fact]
    public void Summary_CountsCellsAndRoundsBabiesToTen()
    {
        var summary = CommunityStatisticsAggregator.Aggregate(Input(tummy: ThreeFullWeeksAndOneThin()), new ExactNoise()).Summary;

        Assert.Equal(new CommunityRunSummary(CellsPublished: 3, CoarseCellsPublished: 1, FineCellsSuppressed: 2, BabiesIncludedRoundedToTen: 80), summary);
    }

    [Fact]
    public void Noise_RealNoiseKeepsSharesInRangeAndOnTheGrid()
    {
        var babies = NewBabies(60, 60);
        var release = Run(Input(tummy: TummyDays(babies, 8, 20), spells: Spells(babies, 20, "sleepy")), new SnappedLaplaceNoise(new SeededRandomSource(42)));

        var values = release.Cells.SelectMany(cell => cell.Outputs.Values).ToArray();
        Assert.NotEmpty(values);
        Assert.All(values, value => Assert.InRange(value, 0m, 1m));
        Assert.All(values, value => Assert.Equal(value, decimal.Round(value, 3)));
    }

    [Theory]
    [InlineData(0UL)]
    [InlineData(ulong.MaxValue)]
    [InlineData(0x8000000000000000UL)]
    [InlineData(1UL)]
    public void Noise_ExtremeRandomness_NeverThrows(ulong bits)
    {
        var babies = NewBabies(60, 60);
        var input = Input(tummy: TummyDays(babies, 8, 20), spells: Spells(babies, 20, "sleepy"));

        var release = Run(input, new SnappedLaplaceNoise(new ConstantRandomSource(bits)));

        Assert.All(release.Cells.SelectMany(cell => cell.Outputs.Values), value => Assert.InRange(value, 0m, 1m));
    }

    [Fact]
    public void Aggregate_IsDeterministicForASeed_AndIndependentOfInputOrder()
    {
        var babies = NewBabies(45, 40);
        var days = TummyDays(babies, 8, 20, days: 3);
        var spells = Spells(babies, 20, "sleepy").Concat(Spells(babies, 20, "gas", day: 1)).ToArray();

        var forward = Run(Input(tummy: days, spells: spells), new SnappedLaplaceNoise(new SeededRandomSource(3)));
        var reversed = Run(Input(tummy: [.. days.Reverse()], spells: [.. spells.Reverse()]), new SnappedLaplaceNoise(new SeededRandomSource(3)));

        Assert.Equal(CommunityReleaseJson.Serialize(forward), CommunityReleaseJson.Serialize(reversed));
    }

    [Fact]
    public void IsDominatedByOneFamily_RawValues_KeepsItsRule()
    {
        var family = Guid.NewGuid();
        Guid[] dominated = [family, family, Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid()];
        Guid[] notDominated = [family, Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid()];

        Assert.True(CommunityStatisticsAggregator.IsDominatedByOneFamily(dominated));
        Assert.False(CommunityStatisticsAggregator.IsDominatedByOneFamily(notDominated));
        Assert.False(CommunityStatisticsAggregator.IsDominatedByOneFamily([]));
    }

    private static IReadOnlyList<CommunityTummyTimeDay> ThreeFullWeeksAndOneThin() =>
        [
            .. TummyDays(NewBabies(25, 25), 0, 10),
            .. TummyDays(NewBabies(25, 25), 1, 10),
            .. TummyDays(NewBabies(25, 25), 2, 10),
            .. TummyDays(NewBabies(5, 5), 3, 5),
        ];
}
