using Lotties.Domain.CryReasons;

namespace Lotties.Domain.Tests.CryReasons;

/// <summary>The invariants of the ranking beyond the shared vectors, and the feed gaps it reads.</summary>
public sealed class CryReasonRankerTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 10, 12, 0, 0, TimeSpan.Zero);

    private static CrySignals Empty() => new(
        CryAgeBand.Weeks6to3m,
        false,
        new CryHungerSignal(false, null, 0, [], null, null, null, null),
        new CrySleepySignal(null, null, false),
        new CryDiaperSignal(null, null, null),
        new CryGasSignal(false, null, false, null, null, 10));

    [Fact]
    public void Rank_AlwaysReturnsAllFiveCausesAndTheSameRedFlags()
    {
        var result = CryReasonRanker.Rank(Empty());

        Assert.Equal(5, result.Causes.Select(rank => rank.Cause).Distinct().Count());
        Assert.Equal(
            [CryRedFlag.Fever, CryRedFlag.Inconsolable, CryRedFlag.RefusingFeeds, CryRedFlag.UnusualSleepiness, CryRedFlag.BulgingOrStiffFontanelle],
            result.RedFlags);
    }

    [Fact]
    public void Rank_NothingLogged_KeepsTheStableTieOrderAndComfortLast()
    {
        var result = CryReasonRanker.Rank(Empty());

        Assert.Equal([CryCause.Hunger, CryCause.Sleepy, CryCause.Diaper, CryCause.Gas, CryCause.Comfort], result.Causes.Select(rank => rank.Cause));
        Assert.All(result.Causes.Take(4), rank => Assert.Equal((CryLevel.Possible, 0.4), (rank.Level, rank.Score)));
        Assert.Equal(0.3, result.Causes[^1].Score);
    }

    [Fact]
    public void Rank_HungryBaby_ListsHungerFirstWithTheMinutesSinceTheLastFeed()
    {
        var signals = Empty() with { Hunger = new CryHungerSignal(true, null, 240, [180, 170, 190, 185], null, null, null, null) };

        var top = CryReasonRanker.Rank(signals).Causes[0];

        Assert.Equal((CryCause.Hunger, CryLevel.Likely), (top.Cause, top.Level));
        var fact = Assert.Single(top.Facts);
        Assert.Equal(("sinceLastFeed", 240, 183), (fact.Kind, fact.Minutes, fact.UsualGapMinutes));
    }

    [Fact]
    public void Rank_Asleep_MakesEveryCauseAnAsleepNoDataFact()
    {
        var result = CryReasonRanker.Rank(Empty() with { Asleep = true });

        Assert.All(result.Causes.Where(rank => rank.Cause != CryCause.Comfort), rank => Assert.Equal("asleep", Assert.Single(rank.Facts).Reason));
    }

    [Fact]
    public void FeedGaps_SessionsCloserThanThirtyMinutesMerge_AndGapsOverEightHoursAreDropped()
    {
        var starts = new[] { Now.AddHours(-30), Now.AddHours(-20), Now.AddMinutes(-600), Now.AddMinutes(-590), Now.AddMinutes(-400), Now.AddMinutes(-100) };

        var gaps = CryFeedGaps.Between(starts, Now).Select(gap => gap.Minutes);

        Assert.Equal([200d, 300d], gaps);
    }

    [Fact]
    public void FeedGaps_StartsOlderThanSeventyTwoHoursOrInTheFuture_AreIgnored()
    {
        var starts = new[] { Now.AddHours(-80), Now.AddHours(-71), Now.AddHours(-69), Now.AddMinutes(30) };

        var gaps = CryFeedGaps.Between(starts, Now);

        Assert.Equal([120d], gaps.Select(gap => gap.Minutes));
    }
}
