using BabyRoutine.Domain.Notifications;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Application.Notifications.Dispatching;

/// <summary>Pending deliveries the retry step re-sends, plus how many it expired or cancelled.</summary>
internal sealed record RetryBatch(IReadOnlyList<OutgoingPush> Outgoing, int Expired, int Cancelled);

/// <summary>
/// Tick step 2 (design section 7): pending deliveries whose next attempt has come are re-sent (also the ones a crash
/// left between claim and send); past their time to live they expire; when their subscription is no longer active they
/// are cancelled. Only hashes of action tokens are stored, so each re-send carries a newly issued token; the content
/// is rebuilt from the stored row (doses: prescription and slot from the key; naps: due time plus the user's nap lead)
/// without names, so a retry always shows the generic lock-screen text.
/// </summary>
internal sealed class NotificationRetryPass(
    INotificationDeliveryRepository deliveries,
    IPushSubscriptionRepository subscriptions,
    IBabyNotificationPreferencesRepository preferences,
    NotificationDispatchSettings settings,
    ILogger<NotificationRetryPass> logger)
{
    public async Task<RetryBatch> PrepareAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var pending = await deliveries.ListPendingDueAsync(now, settings.RetryBatchSize, cancellationToken);
        var expired = pending.Where(delivery => delivery.ExpireIfPastTimeToLive(now)).ToArray();
        var due = pending.Where(delivery => delivery.IsDueForAttemptAt(now)).ToArray();
        var active = await ActiveSubscriptionsAsync(due, now, cancellationToken);
        var cancelled = due.Where(delivery => !active.ContainsKey(delivery.SubscriptionId)).ToArray();
        Array.ForEach(cancelled, delivery => delivery.Cancel());
        var outgoing = new List<OutgoingPush>();
        foreach (var delivery in due.Where(delivery => active.ContainsKey(delivery.SubscriptionId)))
        {
            outgoing.Add(await ResendAsync(delivery, active[delivery.SubscriptionId], now, cancellationToken));
        }

        LogBatch(outgoing.Count, expired.Length, cancelled.Length);
        return new RetryBatch(outgoing, expired.Length, cancelled.Length);
    }

    private async Task<IReadOnlyDictionary<Guid, PushSubscription>> ActiveSubscriptionsAsync(IReadOnlyList<NotificationDelivery> due, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (due.Count == 0)
        {
            return new Dictionary<Guid, PushSubscription>();
        }

        var loaded = await subscriptions.ListByIdsAsync(due.Select(delivery => delivery.SubscriptionId).Distinct().ToArray(), cancellationToken);
        return loaded.Where(subscription => subscription.IsActiveAt(now)).ToDictionary(subscription => subscription.Id);
    }

    private async Task<OutgoingPush> ResendAsync(NotificationDelivery delivery, PushSubscription subscription, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var content = await ContentOfAsync(delivery, cancellationToken);
        var token = delivery.ReissueActionToken();
        return OutgoingPush.Create(delivery, subscription, content, token, UrgencyOf(delivery.Kind), now);
    }

    private async Task<NotificationContent> ContentOfAsync(NotificationDelivery delivery, CancellationToken cancellationToken)
    {
        if (delivery.DedupeKey.TryGetDose(out var prescriptionId, out var slot))
        {
            return new NotificationContent(delivery.BabyId, prescriptionId, slot, null);
        }

        return delivery.Kind == NotificationKind.NapWindow
            ? new NotificationContent(delivery.BabyId, null, await NapWindowStartAsync(delivery, cancellationToken), null)
            : new NotificationContent(delivery.BabyId, null, delivery.DueAt, null);
    }

    /// <summary>A nap reminder was due at <c>earliest - lead</c>; a snooze re-send at the snooze end (shown as is).</summary>
    private async Task<DateTimeOffset> NapWindowStartAsync(NotificationDelivery delivery, CancellationToken cancellationToken)
    {
        if (delivery.DedupeKey.IsSnoozeResend || delivery.BabyId is not { } babyId)
        {
            return delivery.DueAt;
        }

        var stored = await preferences.FindAsync(babyId, delivery.UserId, cancellationToken);
        return delivery.DueAt + (stored?.Preferences ?? ReminderPreferences.Default).NapLead;
    }

    private static NotificationUrgency UrgencyOf(NotificationKind kind) =>
        kind == NotificationKind.DoseDue ? NotificationUrgency.High : NotificationUrgency.Normal;

    private void LogBatch(int resent, int expired, int cancelled)
    {
        if (resent + expired + cancelled > 0)
        {
            logger.LogDebug("Push retry step: {ResentCount} re-sent, {ExpiredCount} expired, {CancelledCount} cancelled", resent, expired, cancelled);
        }
    }
}
