using Lotties.Api.Tests.Support;
using Lotties.Application.CommunityInsights;
using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Notifications;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.CommunityInsights;

/// <summary>
/// <see cref="CommunityAggregationRunner"/> (the community statistics job, which still reads no events and writes placeholders): the
/// release is named after the ISO week of the run (docs/design/34-community-insights.md section 5), and the quarterly cadence
/// (owner decision of 2026-11-27) holds against reruns, stored releases with statistics, unreadable rows, a clock behind and a
/// second instance. Each test starts with no stored release and a free job lease.
/// </summary>
public sealed class CommunityAggregationRunnerTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateTimeOffset Seeded = TestUsers.Now;

    [Theory]
    [InlineData("2026-11-22T03:30:00Z", "2026-W47")]
    [InlineData("2027-01-03T03:30:00Z", "2026-W53")] // a Sunday of calendar year 2027 in the last ISO week of 2026
    [InlineData("2028-01-02T03:30:00Z", "2027-W52")]
    public async Task Run_NamesTheReleaseAfterTheIsoWeekOfTheRun(string runAt, string expectedReleaseId)
    {
        await ResetAsync();
        await SeedEligibleBabyAsync();

        await RunAsync(runAt);

        Assert.Equal(expectedReleaseId, (await ActiveAsync()).ReleaseId);
    }

    [Fact]
    public async Task Run_WritesAPlaceholderReleaseWithNoCell()
    {
        await ResetAsync();
        await SeedEligibleBabyAsync();

        await RunAsync("2026-11-29T03:30:00Z");

        var content = CommunityReleaseJson.Parse((await ActiveAsync()).StatisticsJson);
        Assert.True(content.IsPlaceholder);
        Assert.Empty(content.Cells);
        Assert.Empty(content.Statistics);
    }

    [Fact]
    public async Task Run_AgainInTheSameQuarter_WritesNothing_TheNextQuarterWritesAgain()
    {
        await ResetAsync();
        await SeedEligibleBabyAsync();

        await RunAsync("2026-10-05T03:30:00Z");
        await RunAsync("2026-10-05T04:30:00Z");
        await RunAsync("2026-12-31T23:00:00Z");
        var afterQ4 = await StoredAsync();
        await RunAsync("2027-01-01T01:00:00Z");

        Assert.Single(afterQ4);
        Assert.Equal(["2026-W41", "2026-W53"], (await StoredAsync()).Select(release => release.ReleaseId));
    }

    /// <summary>A placeholder is written at most once per quarter: after a release, a damaged row or the phase-1 placeholder, none.</summary>
    [Theory]
    [InlineData("release")]
    [InlineData("damaged")]
    [InlineData("phase-1-placeholder")]
    public async Task Run_AfterAnyStoredRowThisQuarter_WritesNoPlaceholder(string stored)
    {
        await ResetAsync();
        await SeedEligibleBabyAsync();
        var json = stored switch
        {
            "release" => CommunityReleaseJson.Serialize(new CommunityRelease(Parse("2026-10-02T03:30:00Z"), 2, IsPlaceholder: false, [new("tummy_minutes_per_day", 20, 5m)], [])),
            "damaged" => """{"schema":1,"cells":[{"statistic":"tummy_minutes_per_day"}],"generatedBy":"phase-1-placeholder"}""",
            _ => """{"schema":1,"cells":[],"generatedBy":"phase-1-placeholder"}""",
        };
        await SeedReleaseAsync(json, "2026-10-02T03:30:00Z");

        await RunAsync("2026-11-29T03:30:00Z");

        Assert.Single(await StoredAsync());
    }

    [Fact]
    public async Task Run_WhenTheLatestReleaseIsFromALaterQuarter_WritesNothing()
    {
        await ResetAsync();
        await SeedEligibleBabyAsync();
        await SeedReleaseAsync(CommunityReleaseJson.Serialize(CommunityRelease.Placeholder(Parse("2027-02-01T03:30:00Z"), 2)), "2027-02-01T03:30:00Z");

        await RunAsync("2026-11-29T03:30:00Z");

        Assert.Single(await StoredAsync());
    }

    [Fact]
    public async Task Run_WhileAnotherInstanceHoldsTheLease_WritesNothing()
    {
        await ResetAsync();
        await SeedEligibleBabyAsync();
        await factory.SeedAsync(context =>
        {
            context.JobLeases.Add(JobLease.Create(JobLease.CommunityAggregationName, "other-instance", Parse("2026-11-29T03:00:00Z"), TimeSpan.FromHours(2)));
            return Task.CompletedTask;
        });

        await RunAsync("2026-11-29T03:30:00Z");

        Assert.Empty(await StoredAsync());
    }

    private static DateTimeOffset Parse(string instant) => DateTimeOffset.Parse(instant, System.Globalization.CultureInfo.InvariantCulture);

    private async Task RunAsync(string runAt)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<CommunityAggregationRunner>().RunAsync(Guid.NewGuid(), Parse(runAt), CancellationToken.None);
    }

    private Task<CommunityStatisticsRelease> ActiveAsync() =>
        factory.QueryAsync(context => context.CommunityStatisticsReleases.AsNoTracking().SingleAsync(release => release.Status == CommunityStatisticsReleaseStatus.Active));

    private Task<List<CommunityStatisticsRelease>> StoredAsync() =>
        factory.QueryAsync(context => context.CommunityStatisticsReleases.AsNoTracking().OrderBy(release => release.ReleaseSequence).ToListAsync());

    /// <summary>No stored release and no community job lease: the tests of this class share one database.</summary>
    private Task ResetAsync() =>
        factory.SeedAsync(async context =>
        {
            context.CommunityStatisticsReleases.RemoveRange(await context.CommunityStatisticsReleases.ToListAsync());
            context.JobLeases.RemoveRange(await context.JobLeases.Where(lease => lease.Name == JobLease.CommunityAggregationName).ToListAsync());
        });

    private Task SeedReleaseAsync(string json, string generatedAt) =>
        factory.SeedAsync(context =>
        {
            var release = CommunityStatisticsRelease.CreatePending("seeded", 1, json, Parse(generatedAt));
            release.Activate();
            context.CommunityStatisticsReleases.Add(release);
            return Task.CompletedTask;
        });

    private Task SeedEligibleBabyAsync() =>
        factory.SeedAsync(context =>
        {
            var owner = User.Create("https://issuer.test", TestUsers.NewSubject(), "Owner", Seeded);
            var baby = Baby.Create(null, DateOnly.FromDateTime(Seeded.UtcDateTime.AddMonths(-2)), owner.Id, Seeded);
            context.Users.Add(owner);
            context.Babies.Add(baby);
            context.CommunityConsents.Add(CommunityConsentEntry.Grant(baby.Id, owner.Id, CommunityConsentTexts.CurrentTextVersion, true, "test-policy", "en", Seeded));
            return Task.CompletedTask;
        });
}
