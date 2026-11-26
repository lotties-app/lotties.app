using Lotties.Api.Tests.Support;
using Lotties.Application.CommunityInsights;
using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.CommunityInsights;

/// <summary>
/// <see cref="CommunityAggregationRunner"/> (the phase-1 placeholder run of the community statistics job): the release it activates
/// is named after the ISO week of the run, ISO week-year included (docs/design/34-community-insights.md section 5).
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
        await SeedEligibleBabyAsync();
        var now = DateTimeOffset.Parse(runAt, System.Globalization.CultureInfo.InvariantCulture);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<CommunityAggregationRunner>().RunAsync(Guid.NewGuid(), now, CancellationToken.None);
        }

        var active = await factory.QueryAsync(context => context.CommunityStatisticsReleases.AsNoTracking()
            .SingleAsync(release => release.Status == CommunityStatisticsReleaseStatus.Active));
        Assert.Equal(expectedReleaseId, active.ReleaseId);
    }

    [Fact]
    public async Task Run_WritesAPlaceholderReleaseWithNoCell()
    {
        await SeedEligibleBabyAsync();
        var now = DateTimeOffset.Parse("2026-11-29T03:30:00Z", System.Globalization.CultureInfo.InvariantCulture);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<CommunityAggregationRunner>().RunAsync(Guid.NewGuid(), now, CancellationToken.None);
        }

        var active = await factory.QueryAsync(context => context.CommunityStatisticsReleases.AsNoTracking()
            .SingleAsync(release => release.Status == CommunityStatisticsReleaseStatus.Active));
        var content = CommunityReleaseJson.Parse(active.StatisticsJson);
        Assert.True(content.IsPlaceholder);
        Assert.Empty(content.Cells);
        Assert.Empty(content.Statistics);
    }

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
