using Lotties.Domain.Notifications;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Notifications.Dispatching;

/// <summary>Pending deliveries the retry step re-sends, plus how many it expired or cancelled.</summary>
internal sealed record RetryBatch(IReadOnlyList<OutgoingPush> Outgoing, int Expired, int Cancelled);

/// <summary>
/// Tick step 2 (design section 7): pending deliveries whose next attempt has come are re-sent (also the ones a crash
/// left between claim and send); past their time to live they expire; when their subscription is no longer active they
/// are cancelled. Only hashes of action tokens are stored, so each re-send carries a newly issued token; the content
/// is rebuilt from the stored row (doses: prescription and slot from the key; naps: due time plus the user's nap lead;
/// belly pain and fussy heads-ups: due time plus the fixed 30-minute lead, i.e. the window start; overtired heads-ups:
/// due time plus the fixed 15-minute lead, i.e. the limit; diaper heads-ups: due time plus 10 minutes for wet and
/// 5 minutes for dirty, the expected time from the gaps, an approximation after a feed; appointment reminders:
/// appointment, start and offset from the key; doctor suggestions: the proposal or note from the key, shown at the due
/// time, i.e. when it was sent; vaccine reminders: the dose id from the key, shown at the due time) without names, so a retry always shows the generic lock-screen text.
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

        if (delivery.DedupeKey.TryGetAppointment(out var appointmentId, out var startsAt, out var offsetMinutes))
        {
            return new NotificationContent(delivery.BabyId, null, startsAt, null, appointmentId, offsetMinutes);
        }

        if (delivery.DedupeKey.TryGetVaccine(out var doseId))
        {
            return new NotificationContent(delivery.BabyId, null, delivery.DueAt, null, VaccineDoseId: doseId);
        }

        if (delivery.DedupeKey.TryGetDoctorSuggestion(out var source, out var suggestionId))
        {
            return NotificationContent.ForDoctorSuggestion(delivery.BabyId, source, suggestionId, delivery.DueAt, null);
        }

        return delivery.Kind switch
        {
            NotificationKind.NapWindow => new NotificationContent(delivery.BabyId, null, await NapWindowStartAsync(delivery, cancellationToken), null),
            NotificationKind.BellyPainPattern => new NotificationContent(delivery.BabyId, null, ShownAt(delivery, NotificationRules.BellyPainLead), null),
            NotificationKind.FussyPattern => new NotificationContent(delivery.BabyId, null, ShownAt(delivery, NotificationRules.FussyPatternLead), null),
            NotificationKind.OvertiredWarning => new NotificationContent(delivery.BabyId, null, ShownAt(delivery, NotificationRules.OvertiredLead), null),
            NotificationKind.DiaperWetHeadsUp => new NotificationContent(delivery.BabyId, null, ShownAt(delivery, NotificationRules.DiaperWetLead), null),
            NotificationKind.DiaperDirtyHeadsUp => new NotificationContent(delivery.BabyId, null, ShownAt(delivery, NotificationRules.DiaperDirtyGapLead), null),
            _ => new NotificationContent(delivery.BabyId, null, delivery.DueAt, null),
        };
    }

    /// <summary>
    /// A heads-up with a fixed lead was due at <c>shown time - lead</c> (window start, or the overtired limit); a snooze
    /// re-send at the snooze end (shown as is).
    /// </summary>
    private static DateTimeOffset ShownAt(NotificationDelivery delivery, TimeSpan lead) =>
        delivery.DedupeKey.IsSnoozeResend ? delivery.DueAt : delivery.DueAt + lead;

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
