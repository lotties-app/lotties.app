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
/// While <see cref="CommunityAggregationOptions.ReadEvents"/> is off (the default) it reads no events and writes a placeholder with no
/// cells; with it on it reads the opted-in babies' events and publishes a release with statistics (section 5.3). Behind
/// <see cref="CommunityAggregationOptions.Enabled"/> and <c>CommunityInsights:Enabled</c>.
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
/// One check of the community statistics job, scoped so it gets fresh repositories and its own store scope. Fail closed at every
/// step: the cadence is checked on the latest stored release (<see cref="CommunityReleaseCadence"/>), then again under the job lease
/// (<see cref="JobLease.CommunityAggregationName"/>, one instance at a time across replicas), and the lease is renewed right before the
/// write; any doubt skips the check.
/// <list type="bullet">
/// <item><see cref="CommunityAggregationOptions.ReadEvents"/> off (the default): exactly the behaviour before event loading existed. A
/// placeholder (<see cref="CommunityRelease.Placeholder"/>) is written at most once per quarter, and no event or other data-plane table
/// is queried.</item>
/// <item>On: the cap key must be usable first (<see cref="CommunityCapKeySetting"/>; otherwise nothing is read or written); the
/// population snapshot (<see cref="CommunityPopulation"/>) must not exceed <see cref="CommunityAggregationOptions.MaxBabiesPerRun"/>;
/// the babies' observations are loaded one baby at a time (<see cref="CommunityObservationLoader"/>), aggregated by the pure core
/// with the cryptographic sampler (<see cref="SnappedLaplaceNoise.Cryptographic"/>), serialised and read back by
/// <see cref="CommunityReleaseJson"/>, and only then saved and activated. A placeholder of the same quarter does not block it. Any
/// failure on the way publishes nothing and keeps the active release; the log names the failure's type only.</item>
/// </list>
/// Logs carry counts only, never an id of a baby, family or user, a value or a cell.
/// </summary>
internal sealed class CommunityAggregationRunner(
    ICommunityConsentRepository consents,
    ICommunityStatisticsReleaseRepository releases,
    ICommunityStatisticsCatalogProvider catalogProvider,
    IJobLeaseRepository leases,
    CommunityObservationLoader loader,
    IOptionsSnapshot<CommunityAggregationOptions> options,
    ILogger<CommunityAggregationRunner> logger)
{
    /// <summary>How long one run holds the job lease; far longer than a run takes.</summary>
    public static readonly TimeSpan LeaseDuration = TimeSpan.FromHours(2);

    /// <summary>One check: writes the quarter's release when it is due, else does nothing.</summary>
    public async Task RunAsync(Guid runId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var plan = PlanOf(runId);
        if (plan is null)
        {
            return;
        }

        var holder = $"community-{runId:N}";
        var proceed = await IsDueAsync(runId, plan.Kind, now, cancellationToken)
            && await HoldsLeaseAsync(runId, holder, now, cancellationToken)
            && await IsDueAsync(runId, plan.Kind, now, cancellationToken);
        var eligible = proceed ? await EligibleBabiesAsync(runId, cancellationToken) : [];
        var content = eligible.Count > 0 && IsWithinLimit(runId, plan, eligible) ? await ContentAsync(runId, plan, eligible, now, cancellationToken) : null;
        if (content is null || !await HoldsLeaseAsync(runId, holder, now, cancellationToken))
        {
            return;
        }

        await PublishAsync(runId, plan.Kind, content, now, cancellationToken);
    }

    /// <summary>What this run may write: a placeholder while reading is off; a release only with a usable cap key; else nothing.</summary>
    private RunPlan? PlanOf(Guid runId)
    {
        if (!options.Value.ReadEvents)
        {
            return new RunPlan(CommunityReleaseKind.Placeholder, null);
        }

        var reading = CommunityCapKeySetting.Read(options.Value.CapKey);
        if (reading.Key is null)
        {
            logger.LogError(
                "Run {RunId}: CommunityAggregation:ReadEvents is on but CommunityAggregation:CapKey is unusable ({Problem}; it must be base64 of at least {Bytes} bytes); no events read, nothing published",
                runId, reading.Problem, CommunityCapKey.MinimumLength);
            return null;
        }

        return new RunPlan(CommunityReleaseKind.Release, reading.Key);
    }

    private async Task<bool> IsDueAsync(Guid runId, CommunityReleaseKind kind, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var latest = await releases.GetLatestAsync(cancellationToken);
        var stored = latest is null ? null : CommunityStoredRelease.Of(latest.GeneratedAtUtc, latest.StatisticsJson);
        var due = CommunityReleaseCadence.IsDue(kind, now, stored);
        logger.LogDebug("Run {RunId}: {Kind} due for {Quarter}: {Due}", runId, kind, CommunityQuarter.Of(now), due);
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
    private async Task<IReadOnlyList<Guid>> EligibleBabiesAsync(Guid runId, CancellationToken cancellationToken)
    {
        var (optedIn, eligible) = await CommunityPopulation.SnapshotAsync(consents, cancellationToken);
        logger.LogInformation("Run {RunId}: {Eligible} of {OptedIn} opted-in babies eligible (demo or deleted owner, or not on the built-in store, excluded)",
            runId, eligible.Count, optedIn.Count);
        return eligible;
    }

    /// <summary>A run that would read more babies than <see cref="CommunityAggregationOptions.MaxBabiesPerRun"/> reads none (never a truncated population).</summary>
    private bool IsWithinLimit(Guid runId, RunPlan plan, IReadOnlyList<Guid> eligible)
    {
        var limit = options.Value.MaxBabiesPerRun;
        var within = plan.Kind == CommunityReleaseKind.Placeholder || limit <= 0 || eligible.Count <= limit;
        if (!within)
        {
            logger.LogWarning("Run {RunId}: {Eligible} eligible babies exceed CommunityAggregation:MaxBabiesPerRun ({Limit}); no events read, nothing published", runId, eligible.Count, limit);
        }

        return within;
    }

    private Task<string?> ContentAsync(Guid runId, RunPlan plan, IReadOnlyList<Guid> eligible, DateTimeOffset now, CancellationToken cancellationToken) =>
        plan.CapKey is { } capKey
            ? ReleaseContentAsync(runId, capKey, eligible, now, cancellationToken)
            : Task.FromResult<string?>(CommunityReleaseJson.Serialize(CommunityRelease.Placeholder(now, catalogProvider.Catalog.Version)));

    /// <summary>
    /// Loads, aggregates, serialises and reads back the release; <c>null</c> (nothing published) on any failure, logged by its type
    /// only (an exception text could name a baby or a value). Cancellation is not a failure: it ends the run.
    /// </summary>
    private async Task<string?> ReleaseContentAsync(Guid runId, CommunityCapKey capKey, IReadOnlyList<Guid> eligible, DateTimeOffset now, CancellationToken cancellationToken)
    {
        try
        {
            var loaded = await loader.LoadAsync(eligible, now, cancellationToken);
            var result = CommunityStatisticsAggregator.Aggregate(InputOf(loaded, capKey, now), SnappedLaplaceNoise.Cryptographic());
            var content = ReadBack(result.Release, catalogProvider.Catalog.Version);
            logger.LogInformation(
                "Run {RunId}: read {Read} babies ({LeftOut} left out); {Cells} cells published ({Coarse} coarse), {Suppressed} fine cells with data suppressed, about {Babies} babies included",
                runId, loaded.BabiesRead, loaded.BabiesLeftOut, result.Summary.CellsPublished, result.Summary.CoarseCellsPublished, result.Summary.FineCellsSuppressed, result.Summary.BabiesIncludedRoundedToTen);
            return content;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError("Run {RunId}: reading or aggregating failed ({Failure}); nothing published, the active release stays", runId, exception.GetType().Name);
            return null;
        }
    }

    private CommunityAggregationInput InputOf(CommunityLoadedObservations loaded, CommunityCapKey capKey, DateTimeOffset now) =>
        new(catalogProvider.Catalog, now, capKey, loaded.TummyTimeDays, loaded.CrySpells, loaded.BottleFeeds, loaded.RoutineDays);

    /// <summary>The served text of a release with statistics, read back through the one reader before anything is stored.</summary>
    private static string ReadBack(CommunityRelease release, int catalogVersion)
    {
        var content = CommunityReleaseJson.Serialize(release);
        var stored = CommunityReleaseJson.Parse(content);
        var valid = !stored.IsPlaceholder && stored.CatalogVersion == catalogVersion && stored.Statistics.Count > 0;
        return valid ? content : throw new InvalidOperationException("The community release did not read back as a release with statistics.");
    }

    private async Task PublishAsync(Guid runId, CommunityReleaseKind kind, string statisticsJson, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var sequence = await releases.GetMaxSequenceAsync(cancellationToken) + 1;
        var releaseId = IsoWeekLabel.Of(now);
        var release = CommunityStatisticsRelease.CreatePending(releaseId, sequence, statisticsJson, now);
        await releases.SaveAsync(release, cancellationToken);
        await releases.ActivateAndSupersedePreviousAsync(release.Id, cancellationToken);
        await releases.PruneOldReleasesAsync(cancellationToken);
        logger.LogInformation("Run {RunId}: published {Kind} release {ReleaseId} sequence {Sequence} for {Quarter}", runId, kind, releaseId, sequence, CommunityQuarter.Of(now));
    }

    /// <summary>What a run writes, and the cap key it computes with (only for a release).</summary>
    private sealed record RunPlan(CommunityReleaseKind Kind, CommunityCapKey? CapKey);
}
