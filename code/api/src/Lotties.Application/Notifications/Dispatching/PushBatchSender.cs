using System.Diagnostics;
using Lotties.Application.Push;
using Lotties.Domain.Notifications;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Notifications.Dispatching;

/// <summary>
/// Sends claimed deliveries outside any transaction and records the answers (design section 8, "Responses"): HTTP
/// requests run concurrently (at most <see cref="NotificationDispatchSettings.MaxConcurrentSends"/>); the answers are
/// applied to the tracked rows one by one (the unit of work is not thread-safe) and saved together. The delivery decides
/// its status (<see cref="NotificationDelivery.RecordAttempt"/>); the subscription records success, failure or revocation;
/// a revoked subscription's other pending deliveries are cancelled.
/// </summary>
internal sealed class PushBatchSender(
    IPushSender sender,
    INotificationDeliveryRepository deliveries,
    IPushSubscriptionRepository subscriptions,
    NotificationDispatchSettings settings,
    PushMetrics metrics,
    ILogger<PushBatchSender> logger)
{
    private const int PayloadTooLarge = 413;

    /// <summary>Sends <paramref name="outgoing"/>, applies the answers and saves every pending change of the unit of work.</summary>
    public async Task<SendSummary> SendAsync(IReadOnlyList<OutgoingPush> outgoing, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var results = await SendAllAsync(outgoing, cancellationToken);
        var applied = outgoing.Select((push, index) => Apply(push, results[index], now)).ToArray();
        await deliveries.SaveChangesAsync(cancellationToken);
        await subscriptions.SaveChangesAsync(cancellationToken);
        await CancelPendingOfRevokedAsync(applied.Where(result => result.RevokedSubscription).Select(result => result.SubscriptionId).Distinct(), cancellationToken);
        return applied.Aggregate(SendSummary.Empty, (summary, result) => summary.Add(result.Summary));
    }

    private async Task<PushSendResult[]> SendAllAsync(IReadOnlyList<OutgoingPush> outgoing, CancellationToken cancellationToken)
    {
        var results = new PushSendResult[outgoing.Count];
        var options = new ParallelOptions { MaxDegreeOfParallelism = settings.MaxConcurrentSends, CancellationToken = cancellationToken };
        await Parallel.ForEachAsync(
            Enumerable.Range(0, outgoing.Count),
            options,
            async (index, token) => results[index] = await SendOneAsync(outgoing[index], token));
        return results;
    }

    private async Task<PushSendResult> SendOneAsync(OutgoingPush push, CancellationToken cancellationToken)
    {
        var started = Stopwatch.GetTimestamp();
        try
        {
            return await sender.SendAsync(PushTarget.From(push.Subscription), push.Message, cancellationToken);
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Push send of delivery {DeliveryId} threw {ExceptionType}; treated as no answer", push.Delivery.Id, exception.GetType().Name);
            return PushSendResult.NoResponse();
        }
        finally
        {
            metrics.SendDuration(Stopwatch.GetElapsedTime(started));
        }
    }

    private AppliedResult Apply(OutgoingPush push, PushSendResult result, DateTimeOffset now)
    {
        var delivery = push.Delivery;
        var subscription = push.Subscription;
        var wasRevoked = subscription.IsRevoked;
        var outcome = result.Status == PushSendStatus.EndpointNotAllowed
            ? delivery.RecordRefused()
            : delivery.RecordAttempt(result.StatusCode, result.RetryAfter, now);
        ApplyToSubscription(outcome, subscription, now);
        RecordMetrics(delivery.Kind, outcome, result);
        Log(push, result, outcome, revokedNow: !wasRevoked && subscription.IsRevoked);
        return new AppliedResult(subscription.Id, !wasRevoked && subscription.IsRevoked, SendSummary.Of(outcome));
    }

    private static void ApplyToSubscription(DeliveryAttemptOutcome outcome, PushSubscription subscription, DateTimeOffset now)
    {
        switch (outcome)
        {
            case DeliveryAttemptOutcome.Sent:
                subscription.RecordSuccess(now);
                break;
            case DeliveryAttemptOutcome.Gone:
                subscription.Revoke(SubscriptionRevokeReason.Gone, now);
                break;
            case DeliveryAttemptOutcome.Invalid:
                subscription.Revoke(SubscriptionRevokeReason.Invalid, now);
                break;
            default:
                subscription.RecordFailure(now);
                break;
        }
    }

    private void RecordMetrics(NotificationKind kind, DeliveryAttemptOutcome outcome, PushSendResult result)
    {
        if (outcome == DeliveryAttemptOutcome.Sent)
        {
            metrics.Sent(kind);
            return;
        }

        metrics.Failed(kind, result.StatusCode);
        if (outcome == DeliveryAttemptOutcome.Gone)
        {
            metrics.Gone();
        }
    }

    private void Log(OutgoingPush push, PushSendResult result, DeliveryAttemptOutcome outcome, bool revokedNow)
    {
        logger.LogDebug(
            "Push delivery {DeliveryId} to subscription {SubscriptionId} ({Kind}) via {PushServiceHost}: {StatusCode} -> {Outcome}",
            push.Delivery.Id,
            push.Subscription.Id,
            NotificationCodes.Of(push.Delivery.Kind),
            push.Subscription.Endpoint.Host,
            result.StatusCode,
            outcome);
        if (result.StatusCode == PayloadTooLarge)
        {
            logger.LogError("Push service rejected delivery {DeliveryId} ({Kind}) as too large (413); the payload must stay small", push.Delivery.Id, NotificationCodes.Of(push.Delivery.Kind));
        }

        if (result.Status == PushSendStatus.EndpointNotAllowed)
        {
            logger.LogWarning("Subscription {SubscriptionId} revoked: its push service host {PushServiceHost} is not on the allowlist", push.Subscription.Id, push.Subscription.Endpoint.Host);
        }

        if (revokedNow && outcome is DeliveryAttemptOutcome.Retry or DeliveryAttemptOutcome.Failed)
        {
            logger.LogWarning("Subscription {SubscriptionId} revoked after {FailureCount} consecutive failed sends", push.Subscription.Id, push.Subscription.ConsecutiveFailures);
        }
    }

    private async Task CancelPendingOfRevokedAsync(IEnumerable<Guid> subscriptionIds, CancellationToken cancellationToken)
    {
        foreach (var subscriptionId in subscriptionIds)
        {
            await deliveries.CancelPendingForSubscriptionAsync(subscriptionId, cancellationToken);
        }
    }

    private sealed record AppliedResult(Guid SubscriptionId, bool RevokedSubscription, SendSummary Summary);
}
