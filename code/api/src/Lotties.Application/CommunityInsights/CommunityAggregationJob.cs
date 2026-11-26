using Lotties.Domain.Common;
using Lotties.Domain.CommunityInsights;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Application.CommunityInsights;

/// <summary>
/// Weekly batch process for community statistics (docs/design/34-community-insights.md section 5): snapshots consent at run start,
/// writes a staging release, swaps it to active, and prunes old releases. It reads no events yet: the release it writes is a
/// placeholder with no cells (see <see cref="CommunityAggregationRunner"/>). Behind <see cref="CommunityAggregationOptions.Enabled"/>
/// and <c>CommunityInsights:Enabled</c>.
/// </summary>
public sealed class CommunityAggregationJob(
    IOptionsMonitor<CommunityAggregationOptions> options,
    IOptionsMonitor<CommunityInsightsOptions> insightsOptions,
    IServiceScopeFactory scopes,
    TimeProvider time,
    ILogger<CommunityAggregationJob> logger) : BackgroundService
{
    public static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!ShouldRun())
        {
            logger.LogInformation("Community aggregation job disabled; not starting");
            return;
        }

        try
        {
            await Task.Delay(FirstRunDelay, time, stoppingToken);
            using var timer = new PeriodicTimer(TimeSpan.FromHours(1), time);
            do
            {
                if (IsRunTime())
                {
                    await RunOnceAsync(stoppingToken);
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            logger.LogInformation("Community aggregation job stopped");
        }
    }

    /// <summary>One run in its own scope; exposed for tests.</summary>
    public async Task RunOnceAsync(CancellationToken cancellationToken)
    {
        if (!ShouldRun())
        {
            return;
        }

        var runId = Guid.NewGuid();
        logger.LogInformation("Community aggregation run {RunId} starting", runId);

        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var runner = scope.ServiceProvider.GetRequiredService<CommunityAggregationRunner>();
            await runner.RunAsync(runId, time.GetUtcNow(), cancellationToken);
            logger.LogInformation("Community aggregation run {RunId} completed", runId);
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogError(exception, "Community aggregation run {RunId} failed; next scheduled run retries", runId);
        }
    }

    private bool ShouldRun() => options.CurrentValue.Enabled && insightsOptions.CurrentValue.Enabled;

    private bool IsRunTime()
    {
        var now = time.GetUtcNow().UtcDateTime;
        var config = options.CurrentValue;
        return now.DayOfWeek == config.RunDayOfWeek && now.Hour == config.RunHourUtc;
    }
}

/// <summary>
/// The actual aggregation pipeline, scoped per run so it gets fresh repositories and can be tested independently of the timer.
/// Today a placeholder: it takes the population snapshot and writes a placeholder release (<see cref="CommunityRelease.Placeholder"/>);
/// it reads no events. The computation itself is the pure Domain core <see cref="CommunityStatisticsAggregator"/>, not wired yet.
/// </summary>
internal sealed class CommunityAggregationRunner(
    ICommunityConsentRepository consents,
    ICommunityStatisticsReleaseRepository releases,
    ICommunityStatisticsCatalogProvider catalogProvider,
    ILogger<CommunityAggregationRunner> logger)
{
    /// <summary>Runs the full aggregation pipeline for one tick.</summary>
    public async Task RunAsync(Guid runId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var catalog = catalogProvider.Catalog;
        if (catalog.Statistics.Count == 0)
        {
            logger.LogInformation("Run {RunId}: catalog has no statistics; nothing to aggregate", runId);
            return;
        }

        // Snapshot consent at run start to prevent race conditions during the run. Babies whose owner is a demo or deleted
        // account are excluded, and so is every baby not settled on the built-in store (her own database, a move between stores
        // in progress or in its undo window; design 47): only babies owned by real users, whose records are in the Lotties
        // database, contribute to community statistics.
        var (optedInBabies, eligibleBabies) = await CommunityPopulation.SnapshotAsync(consents, cancellationToken);
        if (optedInBabies.Count == 0)
        {
            logger.LogInformation("Run {RunId}: no babies opted in; graceful no-op", runId);
            return;
        }

        if (eligibleBabies.Count == 0)
        {
            logger.LogInformation("Run {RunId}: all {Total} opted-in babies excluded (demo/deleted owner or not on the built-in store); graceful no-op",
                runId, optedInBabies.Count);
            return;
        }

        if (eligibleBabies.Count < optedInBabies.Count)
        {
            logger.LogInformation("Run {RunId}: excluded {Excluded} of {Total} opted-in babies (demo/deleted owner or not on the built-in store), {Eligible} eligible",
                runId, optedInBabies.Count - eligibleBabies.Count, optedInBabies.Count, eligibleBabies.Count);
        }

        logger.LogInformation("Run {RunId}: {BabyCount} eligible babies, {StatisticCount} statistics in catalog",
            runId, eligibleBabies.Count, catalog.Statistics.Count);

        // TODO (event loading, a later task): derive the CommunityAggregationInput observations of the eligible babies from the Lotties
        // database (the snapshot already left out every baby not on the built-in store) and serialise
        // CommunityStatisticsAggregator.Aggregate(input, SnappedLaplaceNoise.Cryptographic()).Release instead of the placeholder.

        // Placeholder: a release with no statistics and no cells (read like an empty release: every caller falls back to the norms),
        // written to exercise the staging/swap/prune pipeline.
        var sequence = await releases.GetMaxSequenceAsync(cancellationToken) + 1;
        var releaseId = IsoWeekLabel.Of(now);
        var statisticsJson = CommunityReleaseJson.Serialize(CommunityRelease.Placeholder(now, catalog.Version));

        var release = CommunityStatisticsRelease.CreatePending(releaseId, sequence, statisticsJson, now);
        await releases.SaveAsync(release, cancellationToken);
        logger.LogInformation("Run {RunId}: saved pending release {ReleaseId} sequence {Sequence}", runId, releaseId, sequence);

        await releases.ActivateAndSupersedePreviousAsync(release.Id, cancellationToken);
        logger.LogInformation("Run {RunId}: activated release {ReleaseId}", runId, releaseId);

        await releases.PruneOldReleasesAsync(cancellationToken);
        logger.LogInformation("Run {RunId}: pruned old releases", runId);
    }

    }