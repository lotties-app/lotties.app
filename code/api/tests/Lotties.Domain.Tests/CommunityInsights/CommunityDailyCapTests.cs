using Lotties.Domain.CommunityInsights;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// The per-baby cap (<see cref="CommunityDailyCap"/>, docs/design/34-community-insights.md section 5): at most the cap of days per
/// baby and band, picked by a keyed hash of baby id and day, the same pick on every run and in any input order.
/// </summary>
public sealed class CommunityDailyCapTests
{
    private static readonly DateOnly Start = new(2026, 8, 1);

    private static readonly CommunityCapKey Key = CommunityCapKey.From(Enumerable.Repeat((byte)7, 32).ToArray());

    private static readonly CommunityCapKey OtherKey = CommunityCapKey.From(Enumerable.Repeat((byte)8, 32).ToArray());

    private static IReadOnlyList<DateOnly> Days(int count) => [.. Enumerable.Range(0, count).Select(Start.AddDays)];

    [Fact]
    public void SelectDays_KeepsAtMostTheCap()
    {
        var baby = Guid.NewGuid();

        Assert.Equal(14, CommunityDailyCap.SelectDays(baby, Days(30), 14, Key).Count);
        Assert.Equal(5, CommunityDailyCap.SelectDays(baby, Days(5), 14, Key).Count);
        Assert.Equal(3, CommunityDailyCap.SelectDays(baby, [Start, Start, Start.AddDays(1), Start.AddDays(2), Start.AddDays(2)], 14, Key).Count);
    }

    [Fact]
    public void SelectDays_IsDeterministic_AndIndependentOfInputOrder()
    {
        var baby = Guid.NewGuid();
        var days = Days(40);

        var first = CommunityDailyCap.SelectDays(baby, days, 14, Key);
        var again = CommunityDailyCap.SelectDays(baby, days, 14, CommunityCapKey.From(Enumerable.Repeat((byte)7, 32).ToArray()));
        var shuffled = CommunityDailyCap.SelectDays(baby, days.OrderBy(day => (day.DayNumber * 7919) % 101), 14, Key);

        Assert.Equal(first, again);
        Assert.Equal(first, shuffled);
    }

    [Fact]
    public void SelectDays_DependsOnTheKeyAndTheBaby()
    {
        var baby = Guid.NewGuid();
        var days = Days(60);

        var withKey = CommunityDailyCap.SelectDays(baby, days, 14, Key);

        Assert.NotEqual(withKey, CommunityDailyCap.SelectDays(baby, days, 14, OtherKey));
        Assert.NotEqual(withKey, CommunityDailyCap.SelectDays(Guid.NewGuid(), days, 14, Key));
    }

    [Fact]
    public void SelectDays_ANewDay_DisplacesAtMostOneKeptDay()
    {
        var baby = Guid.NewGuid();
        var before = CommunityDailyCap.SelectDays(baby, Days(30), 14, Key);

        var after = CommunityDailyCap.SelectDays(baby, Days(31), 14, Key);

        Assert.True(before.Intersect(after).Count() >= 13);
    }

    [Fact]
    public void SelectDays_IsSpreadOverThePeriod_NotTheFirstDays()
    {
        var picks = Enumerable.Range(0, 200).SelectMany(index => CommunityDailyCap.SelectDays(new Guid(index, 0, 0, new byte[8]), Days(28), 14, Key)).ToArray();

        // Every day of the 28 is picked about half of the time.
        Assert.All(Days(28), day => Assert.InRange(picks.Count(pick => pick == day) / 200.0, 0.35, 0.65));
    }

    [Fact]
    public void Key_ShorterThan32Bytes_IsRefused_AndNeverPrinted()
    {
        Assert.Throws<ArgumentException>(() => CommunityCapKey.From(new byte[31]));
        Assert.Equal(nameof(CommunityCapKey), Key.ToString());
    }
}
