using Lotties.Application.Notifications;
using Lotties.Domain.Common;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Notifications;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Application.CommunityInsights;

/// <summary>
/// The community statistics job (docs/design/34-community-insights.md section 5): wakes every hour and asks
/// <see cref="CommunityAggregationRunner"/> whether a release is due under the quarterly cadence (owner decision of 2026-11-27:
/// at most one release with statistics per calendar quarter, decided from the latest stored release, never from configuration).
/// It reads no events yet: what it writes is a placeholder with no cells. Behind <see cref="CommunityAggregationOptions.Enabled"/>
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

    /// <summary>How often the job checks whether a release is due; the cadence itself is quarterly.</summary>
    public static readonly TimeSpan CheckInterval = TimeSpan.FromHours(1);

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
            using var timer = new PeriodicTimer(CheckInterval, time);
            do
            {
                await RunOnceAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            logger.LogInformation("Community aggregation job stopped");
        }
    }

    /// <summary>One check in its own scope; exposed for tests.</summary>
    public async Task RunOnceAsync(CancellationToken cancellationToken)
    {
        if (!ShouldRun())
        {
            return;
        }

        var runId = Guid.NewGuid();
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var runner = scope.ServiceProvider.GetRequiredService<CommunityAggregationRunner>();
            await runner.RunAsync(runId, time.GetUtcNow(), cancellationToken);
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogError(exception, "Community aggregation run {RunId} failed; the next check retries", runId);
        }
    }

    private bool ShouldRun() => options.CurrentValue.Enabled && insightsOptions.CurrentValue.Enabled;
}

/// <summary>
/// One check of the community statistics job, scoped so it gets fresh repositories. Today it only ever writes a placeholder
/// (<see cref="CommunityRelease.Placeholder"/>) and reads no events; the computation itself is the pure Domain core
/// <see cref="CommunityStatisticsAggregator"/>, not wired yet. Fail closed at every step: the cadence is checked on the latest stored
/// release (<see cref="CommunityReleaseCadence"/>), then again under the job lease (<see cref="JobLease.CommunityAggregationName"/>,
/// one instance at a time across replicas), and the lease is renewed right before the write; any doubt skips the check.
/// </summary>
internal sealed class CommunityAggregationRunner(
    ICommunityConsentRepository consents,
    ICommunityStatisticsReleaseRepository releases,
    ICommunityStatisticsCatalogProvider catalogProvider,
    IJobLeaseRepository leases,
    ILogger<CommunityAggregationRunner> logger)
{
    /// <summary>How long one run holds the job lease; far longer than a run takes.</summary>
    public static readonly TimeSpan LeaseDuration = TimeSpan.FromHours(2);

    /// <summary>What a run writes while event loading is not built.</summary>
    private const CommunityReleaseKind Kind = CommunityReleaseKind.Placeholder;

    /// <summary>One check: writes the quarter's release when it is due, else does nothing.</summary>
    public async Task RunAsync(Guid runId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var holder = $"community-{runId:N}";
        var proceed = await IsDueAsync(runId, now, cancellationToken)
            && await HoldsLeaseAsync(runId, holder, now, cancellationToken)
            && await IsDueAsync(runId, now, cancellationToken)
            && await HasEligibleBabiesAsync(runId, cancellationToken)
            && await HoldsLeaseAsync(runId, holder, now, cancellationToken);
        if (!proceed)
        {
            return;
        }

        await PublishPlaceholderAsync(runId, now, cancellationToken);
    }

    private async Task<bool> IsDueAsync(Guid runId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var latest = await releases.GetLatestAsync(cancellationToken);
        var stored = latest is null ? null : CommunityStoredRelease.Of(latest.GeneratedAtUtc, latest.StatisticsJson);
        var due = CommunityReleaseCadence.IsDue(Kind, now, stored);
        logger.LogDebug("Run {RunId}: {Kind} due for {Quarter}: {Due}", runId, Kind, CommunityQuarter.Of(now), due);
        return due;
    }

    private async Task<bool> HoldsLeaseAsync(Guid runId, string holder, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var held = await leases.TryAcquireAsync(JobLease.CommunityAggregationName, holder, now, LeaseDuration, cancellationToken);
        if (!held)
        {
            logger.LogInformation("Run {RunId}: another instance holds the community aggregation lease; skipped", runId);
        }

        return held;
    }

    /// <summary>
    /// The consent snapshot of the run (<see cref="CommunityPopulation"/>): babies with a current consent, a real Owner, settled on
    /// the built-in store. Nothing is written while no baby is eligible.
    /// </summary>
    private async Task<bool> HasEligibleBabiesAsync(Guid runId, CancellationToken cancellationToken)
    {
        var (optedIn, eligible) = await CommunityPopulation.SnapshotAsync(consents, cancellationToken);
        logger.LogInformation("Run {RunId}: {Eligible} of {OptedIn} opted-in babies eligible (demo or deleted owner, or not on the built-in store, excluded)",
            runId, eligible.Count, optedIn.Count);
        return eligible.Count > 0;
    }

    // TODO (event loading, a later task): derive the CommunityAggregationInput observations of the eligible babies from the Lotties
    // database (the snapshot already left out every baby not on the built-in store), use CommunityReleaseKind.Release for the
    // cadence, and serialise CommunityStatisticsAggregator.Aggregate(input, SnappedLaplaceNoise.Cryptographic()).Release.
    private async Task PublishPlaceholderAsync(Guid runId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var sequence = await releases.GetMaxSequenceAsync(cancellationToken) + 1;
        var releaseId = IsoWeekLabel.Of(now);
        var statisticsJson = CommunityReleaseJson.Serialize(CommunityRelease.Placeholder(now, catalogProvider.Catalog.Version));
        var release = CommunityStatisticsRelease.CreatePending(releaseId, sequence, statisticsJson, now);
        await releases.SaveAsync(release, cancellationToken);
        await releases.ActivateAndSupersedePreviousAsync(release.Id, cancellationToken);
        await releases.PruneOldReleasesAsync(cancellationToken);
        logger.LogInformation("Run {RunId}: published placeholder release {ReleaseId} sequence {Sequence} for {Quarter}", runId, releaseId, sequence, CommunityQuarter.Of(now));
    }
}
