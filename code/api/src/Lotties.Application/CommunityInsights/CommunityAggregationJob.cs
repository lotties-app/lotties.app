using Lotties.Domain.CommunityInsights;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Application.CommunityInsights;

/// <summary>
/// Weekly batch process that aggregates community statistics for opted-in babies (docs/design/34-community-insights.md section 5):
/// snapshots consent at run start, loads events for opted-in babies (excluding BYO stores), applies clipping/capping/suppression/noise
/// per catalog, writes to a staging release, swaps it to active, and prunes old releases. Off by default
/// (<see cref="CommunityAggregationOptions.Enabled"/>); turning it on in production is task T9.
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
/// Phase 1: full pipeline structure with simplified Laplace-only noise; tier-B exponential mechanism for percentiles is gated
/// (TODO: implement when tier-B is activated in a future phase).
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

        // Snapshot consent at run start to prevent race conditions during the run
        var optedInBabies = await consents.BabiesInForceAsync(CommunityConsentTexts.CurrentTextVersion, cancellationToken);
        if (optedInBabies.Count == 0)
        {
            logger.LogInformation("Run {RunId}: no babies opted in; graceful no-op", runId);
            return;
        }

        // Exclude babies whose owner is a demo or deleted account.
        // Only babies owned by real users should contribute to community statistics.
        var eligibleBabies = await consents.FilterEligibleBabiesAsync(optedInBabies, cancellationToken);
        if (eligibleBabies.Count == 0)
        {
            logger.LogInformation("Run {RunId}: all {Total} opted-in babies excluded (demo/test/inactive); graceful no-op",
                runId, optedInBabies.Count);
            return;
        }

        if (eligibleBabies.Count < optedInBabies.Count)
        {
            logger.LogInformation("Run {RunId}: excluded {Excluded} of {Total} opted-in babies (demo/test/inactive), {Eligible} eligible",
                runId, optedInBabies.Count - eligibleBabies.Count, optedInBabies.Count, eligibleBabies.Count);
        }

        logger.LogInformation("Run {RunId}: {BabyCount} eligible babies, {StatisticCount} statistics in catalog",
            runId, eligibleBabies.Count, catalog.Statistics.Count);

        // TODO: Load events for opted-in babies (excluding BYO stores via IStoreScope fail-closed contract).
        // TODO: Apply clipping per catalog Clip ranges, per-baby cap of 14 days per cell (keyed hash of baby id + day).
        // TODO: Build cellsByBand per statistic and call CommunityStatisticsAggregator.Aggregate.
        // TODO: Serialize aggregated cells to JSON blob.

        // Phase 1 placeholder: write an empty-but-valid release to exercise the staging/swap/prune pipeline.
        var sequence = await releases.GetMaxSequenceAsync(cancellationToken) + 1;
        var releaseId = $"{now:yyyy-'W'ww}";
        var statisticsJson = """{"schema":1,"cells":[],"generatedBy":"phase-1-placeholder"}""";

        var release = CommunityStatisticsRelease.CreatePending(releaseId, sequence, statisticsJson, now);
        await releases.SaveAsync(release, cancellationToken);
        logger.LogInformation("Run {RunId}: saved pending release {ReleaseId} sequence {Sequence}", runId, releaseId, sequence);

        await releases.ActivateAndSupersedePreviousAsync(release.Id, cancellationToken);
        logger.LogInformation("Run {RunId}: activated release {ReleaseId}", runId, releaseId);

        await releases.PruneOldReleasesAsync(cancellationToken);
        logger.LogInformation("Run {RunId}: pruned old releases", runId);
    }

    }