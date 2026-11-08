using Lotties.Application.Stores;
using Lotties.Domain.Notifications;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Notifications.Dispatching;

/// <summary>
/// Tick step 3 (design section 7): the candidate babies (a member with a kind on, Owner or Parent, with an active
/// subscription), each planned by the pure <see cref="NotificationPlanner"/> with the recipients' settings, their
/// snoozes and dismissals and the keys already claimed for them. A baby whose data cannot be planned is logged and
/// skipped so the other babies still get their reminders. Each baby is entered in the tick's <see cref="IStoreScope"/> before its
/// data is read (a job has no request to do it). Reminders are not available for a baby on a family's own database in the first
/// version (docs/design/47-bring-your-own-database.md D9 and section 2.2, task T11): the candidates query already leaves such a
/// baby out by its pointer, and a baby that moved since is skipped here by its pointer in the control plane, before any data-plane
/// read and without opening its store.
/// </summary>
internal sealed class NotificationPlanningPass(
    IBabyNotificationPreferencesRepository preferences,
    IUserNotificationSettingsRepository settings,
    INotificationDeliveryRepository deliveries,
    NotificationPlanInputLoader loader,
    IStoreScope stores,
    PushMetrics metrics,
    ILogger<NotificationPlanningPass> logger)
{
    /// <summary>
    /// How far back claimed keys are read: longer than any reminder can be planned after its send time (stale cutoffs
    /// of 15-30 minutes, snooze re-sends within the 12 hour action window).
    /// </summary>
    public static readonly TimeSpan ClaimedKeysLookBack = TimeSpan.FromDays(1);

    /// <summary>The kinds whose sent heads-ups count toward a daily cap and the spacing (docs/design/09-push-notifications.md section 2.8).</summary>
    private static readonly IReadOnlyCollection<NotificationKind> CappedKinds = [NotificationKind.DiaperWetHeadsUp, NotificationKind.DiaperDirtyHeadsUp];

    public async Task<IReadOnlyList<PlannedNotification>> PlanAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var candidates = await preferences.ListCandidatesAsync(now, cancellationToken);
        if (candidates.Count == 0)
        {
            return [];
        }

        var userIds = candidates.Select(candidate => candidate.UserId).Distinct().ToArray();
        var settingsByUser = (await settings.ListForUsersAsync(userIds, cancellationToken)).ToDictionary(stored => stored.UserId);
        var delivered = await deliveries.ListClaimedKeysAsync(userIds, now - ClaimedKeysLookBack, cancellationToken);
        var sentHeadsUps = await SentHeadsUpsAsync(candidates, userIds, now, cancellationToken);
        var planned = new List<PlannedNotification>();
        foreach (var baby in candidates.GroupBy(candidate => candidate.BabyId))
        {
            planned.AddRange(await PlanBabyAsync(baby.Key, baby.ToArray(), settingsByUser, new ClaimHistory(delivered, sentHeadsUps), now, cancellationToken));
        }

        return planned;
    }

    /// <summary>The capped heads-ups of the last day (a local day is never longer), loaded only when someone wants a diaper heads-up.</summary>
    private Task<IReadOnlyList<SentHeadsUp>> SentHeadsUpsAsync(IReadOnlyList<NotificationCandidate> candidates, IReadOnlyCollection<Guid> userIds, DateTimeOffset now, CancellationToken cancellationToken) =>
        candidates.Any(candidate => candidate.Preferences.WantsDiapers)
            ? deliveries.ListSentHeadsUpsAsync(userIds, CappedKinds, now - ClaimedKeysLookBack, cancellationToken)
            : Task.FromResult<IReadOnlyList<SentHeadsUp>>([]);

    private async Task<IReadOnlyList<PlannedNotification>> PlanBabyAsync(
        Guid babyId,
        IReadOnlyList<NotificationCandidate> candidates,
        IReadOnlyDictionary<Guid, UserNotificationSettings> settingsByUser,
        ClaimHistory claims,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        try
        {
            if (!await stores.TryEnterBuiltInAsync(babyId, cancellationToken))
            {
                logger.LogDebug("Push planning skipped baby {BabyId}: its records are on an external store (no reminders)", babyId);
                return [];
            }

            var recipients = candidates
                .Select(candidate => NotificationRecipient.From(candidate.UserId, candidate.Role, candidate.Preferences, settingsByUser.GetValueOrDefault(candidate.UserId), now))
                .ToArray();
            var plan = NotificationPlanner.Plan(await loader.LoadAsync(babyId, recipients, claims, now, cancellationToken));
            RecordMetrics(plan);
            return plan.Notifications;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Push planning skipped baby {BabyId} in this tick", babyId);
            return [];
        }
    }

    private void RecordMetrics(NotificationPlan plan)
    {
        foreach (var planned in plan.Notifications)
        {
            metrics.Planned(planned.Kind);
        }

        foreach (var skipped in plan.Skipped)
        {
            metrics.Skipped(skipped.Reason);
        }
    }
}
