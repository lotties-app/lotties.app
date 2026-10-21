using System.Diagnostics;
using Lotties.Domain.Notifications;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Notifications.Dispatching;

/// <summary>
/// One scheduler tick (docs/design/09-push-notifications.md section 7): lease, retry, plan, claim and send,
/// housekeeping. Polling recomputes everything from current data, so a logged dose, a started sleep or an edited
/// prescription is reflected on the next tick without invalidation. All decisions are the Domain's
/// (<see cref="NotificationPlanner"/>, <see cref="NotificationDelivery"/>, <see cref="PushSubscription"/>); this class only
/// loads, orders the steps and saves. Delivery is at least once: a claim exists before its send.
/// </summary>
internal sealed class NotificationDispatcher(
    IJobLeaseRepository leases,
    IPushSubscriptionRepository subscriptions,
    NotificationRetryPass retries,
    NotificationPlanningPass planning,
    NotificationClaimer claimer,
    PushBatchSender sender,
    NotificationHousekeeping housekeeping,
    PushMetrics metrics,
    ILogger<NotificationDispatcher> logger) : INotificationDispatcher
{
    /// <summary>A tick slower than this is logged as a warning (time to add a per-baby next-check cache).</summary>
    public static readonly TimeSpan SlowTick = TimeSpan.FromSeconds(10);

    public async Task<NotificationTickResult> DispatchAsync(NotificationTickRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var started = Stopwatch.GetTimestamp();
        if (!await leases.TryAcquireAsync(JobLease.PushSchedulerName, request.HolderId, request.Now, request.LeaseDuration, cancellationToken))
        {
            logger.LogDebug("Push scheduler lease is held by another instance; tick skipped");
            return NotificationTickResult.LeaseNotHeld;
        }

        var retry = await retries.PrepareAsync(request.Now, cancellationToken);
        var retried = await sender.SendAsync(retry.Outgoing, request.Now, cancellationToken);
        var planned = await planning.PlanAsync(request.Now, cancellationToken);
        var claims = await claimer.ClaimAsync(planned, request.Now, cancellationToken);
        var sent = await sender.SendAsync(claims.Outgoing, request.Now, cancellationToken);
        await RunHousekeepingAsync(request, cancellationToken);
        metrics.ActiveSubscriptions(await subscriptions.CountActiveAsync(request.Now, cancellationToken));
        var result = Summarize(request, retry, retried.Add(sent), planned.Count, claims);
        Report(result, Stopwatch.GetElapsedTime(started));
        return result;
    }

    private async Task RunHousekeepingAsync(NotificationTickRequest request, CancellationToken cancellationToken)
    {
        if (request.RunHousekeeping)
        {
            await housekeeping.RunAsync(request.Now, cancellationToken);
        }
    }

    private static NotificationTickResult Summarize(NotificationTickRequest request, RetryBatch retry, SendSummary sends, int planned, ClaimBatch claims) =>
        new(
            LeaseHeld: true,
            Retried: retry.Outgoing.Count,
            Planned: planned,
            Claimed: claims.Claimed,
            Sent: sends.Sent,
            Retrying: sends.Retrying,
            Failed: sends.Failed,
            Gone: sends.Gone,
            Expired: retry.Expired + claims.Expired,
            Cancelled: retry.Cancelled,
            HousekeepingRan: request.RunHousekeeping);

    private void Report(NotificationTickResult result, TimeSpan elapsed)
    {
        metrics.TickDuration(elapsed);
        if (elapsed > SlowTick)
        {
            logger.LogWarning("Push scheduler tick took {ElapsedSeconds:F1} s (planned {PlannedCount})", elapsed.TotalSeconds, result.Planned);
        }

        if (result.Sent + result.Retrying + result.Failed + result.Gone > 0)
        {
            logger.LogInformation(
                "Push tick: {SentCount} sent, {RetryingCount} retrying, {FailedCount} failed, {GoneCount} gone ({PlannedCount} planned, {ClaimedCount} claimed, {RetriedCount} retried)",
                result.Sent,
                result.Retrying,
                result.Failed,
                result.Gone,
                result.Planned,
                result.Claimed,
                result.Retried);
        }
    }
}
