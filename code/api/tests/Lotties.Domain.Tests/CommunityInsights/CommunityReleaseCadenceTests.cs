using Lotties.Domain.CommunityInsights;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// The quarterly cadence (<see cref="CommunityReleaseCadence"/>, owner decision of 2026-11-27): at most one release with statistics
/// per calendar quarter, decided from the latest stored release; a placeholder does not count; any doubt fails closed.
/// </summary>
public sealed class CommunityReleaseCadenceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 27, 12, 0, 0, TimeSpan.Zero);

    private static CommunityStoredRelease Real(DateTimeOffset at) => new(at, CountsAgainstQuarter: true);

    private static CommunityStoredRelease Placeholder(DateTimeOffset at) => new(at, CountsAgainstQuarter: false);

    [Theory]
    [InlineData("2026-01-01T00:00:00Z", 2026, 1)]
    [InlineData("2026-03-31T23:59:59Z", 2026, 1)]
    [InlineData("2026-04-01T00:00:00Z", 2026, 2)]
    [InlineData("2026-12-31T23:59:59Z", 2026, 4)]
    [InlineData("2027-01-01T02:00:00+03:00", 2026, 4)]
    public void Quarter_IsTheUtcCalendarQuarter(string instant, int year, int quarter)
    {
        var of = CommunityQuarter.Of(DateTimeOffset.Parse(instant, System.Globalization.CultureInfo.InvariantCulture));

        Assert.Equal(new CommunityQuarter(year, quarter), of);
        Assert.Equal($"{year}-Q{quarter}", of.ToString());
    }

    [Fact]
    public void Quarter_StartsAndOrder()
    {
        var q4 = new CommunityQuarter(2026, 4);

        Assert.Equal(new DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero), q4.Start);
        Assert.Equal(new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero), q4.NextStart);
        Assert.True(new CommunityQuarter(2027, 1) > q4);
        Assert.True(new CommunityQuarter(2026, 3) < q4);
    }

    [Theory]
    [InlineData(CommunityReleaseKind.Release)]
    [InlineData(CommunityReleaseKind.Placeholder)]
    public void NoStoredRelease_IsDue(CommunityReleaseKind kind)
    {
        Assert.True(CommunityReleaseCadence.IsDue(kind, Now, latest: null));
    }

    [Fact]
    public void ReleaseInTheSameQuarter_BlocksEverythingUntilTheNextQuarter()
    {
        var latest = Real(new DateTimeOffset(2026, 10, 1, 3, 30, 0, TimeSpan.Zero));

        Assert.False(CommunityReleaseCadence.IsDue(CommunityReleaseKind.Release, Now, latest));
        Assert.False(CommunityReleaseCadence.IsDue(CommunityReleaseKind.Placeholder, Now, latest));
        Assert.False(CommunityReleaseCadence.IsDue(CommunityReleaseKind.Release, new DateTimeOffset(2026, 12, 31, 23, 59, 59, TimeSpan.Zero), latest));
        Assert.True(CommunityReleaseCadence.IsDue(CommunityReleaseKind.Release, new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero), latest));
    }

    [Fact]
    public void PlaceholderInTheSameQuarter_DoesNotCount_ButIsNotWrittenTwice()
    {
        var latest = Placeholder(new DateTimeOffset(2026, 10, 5, 0, 0, 0, TimeSpan.Zero));

        Assert.True(CommunityReleaseCadence.IsDue(CommunityReleaseKind.Release, Now, latest));
        Assert.False(CommunityReleaseCadence.IsDue(CommunityReleaseKind.Placeholder, Now, latest));
    }

    [Fact]
    public void LatestFromAnEarlierQuarter_IsDue()
    {
        var latest = Real(new DateTimeOffset(2026, 9, 30, 23, 0, 0, TimeSpan.Zero));

        Assert.True(CommunityReleaseCadence.IsDue(CommunityReleaseKind.Release, Now, latest));
        Assert.True(CommunityReleaseCadence.IsDue(CommunityReleaseKind.Placeholder, Now, latest));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void LatestFromALaterQuarter_ClockBehind_FailsClosed(bool counts)
    {
        var latest = new CommunityStoredRelease(new DateTimeOffset(2027, 2, 1, 0, 0, 0, TimeSpan.Zero), counts);

        Assert.False(CommunityReleaseCadence.IsDue(CommunityReleaseKind.Release, Now, latest));
        Assert.False(CommunityReleaseCadence.IsDue(CommunityReleaseKind.Placeholder, Now, latest));
    }

    [Fact]
    public void StoredRow_UnreadableContent_CountsAsARelease()
    {
        var at = new DateTimeOffset(2026, 10, 2, 0, 0, 0, TimeSpan.Zero);

        var legacy = CommunityStoredRelease.Of(at, """{"schema":1,"cells":[],"generatedBy":"phase-1-placeholder"}""");
        var damaged = CommunityStoredRelease.Of(at, "{");

        Assert.True(legacy.CountsAgainstQuarter);
        Assert.True(damaged.CountsAgainstQuarter);
        Assert.False(CommunityReleaseCadence.IsDue(CommunityReleaseKind.Release, Now, legacy));
    }

    [Fact]
    public void StoredRow_PlaceholderAndRelease_AreToldApart()
    {
        var at = new DateTimeOffset(2026, 10, 2, 0, 0, 0, TimeSpan.Zero);
        var placeholder = CommunityReleaseJson.Serialize(CommunityRelease.Placeholder(at, 2));
        var release = CommunityReleaseJson.Serialize(new CommunityRelease(at, 2, IsPlaceholder: false, [new("tummy_minutes_per_day", 20, 5m)], []));

        Assert.False(CommunityStoredRelease.Of(at, placeholder).CountsAgainstQuarter);
        Assert.True(CommunityStoredRelease.Of(at, release).CountsAgainstQuarter);
    }

    [Fact]
    public void AnySequenceOfChecks_PublishesAtMostOneReleasePerQuarter()
    {
        // Hourly checks over two years, with a placeholder sometimes written first: never two releases in one quarter.
        var random = new SeededRandomSource(5);
        CommunityStoredRelease? latest = null;
        var releasesPerQuarter = new Dictionary<CommunityQuarter, int>();
        for (var now = new DateTimeOffset(2026, 7, 1, 0, 0, 0, TimeSpan.Zero); now.Year < 2028; now = now.AddHours(1 + random.Next(300)))
        {
            var kind = random.Next(4) == 0 ? CommunityReleaseKind.Placeholder : CommunityReleaseKind.Release;
            if (!CommunityReleaseCadence.IsDue(kind, now, latest))
            {
                continue;
            }

            latest = new CommunityStoredRelease(now, kind == CommunityReleaseKind.Release);
            releasesPerQuarter[CommunityQuarter.Of(now)] = releasesPerQuarter.GetValueOrDefault(CommunityQuarter.Of(now)) + (kind == CommunityReleaseKind.Release ? 1 : 0);
        }

        Assert.All(releasesPerQuarter.Values, count => Assert.InRange(count, 0, 1));
        Assert.True(releasesPerQuarter.Values.Sum() >= 6);
    }
}
