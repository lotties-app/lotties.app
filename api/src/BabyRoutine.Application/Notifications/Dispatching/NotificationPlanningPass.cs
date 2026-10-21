using BabyRoutine.Domain.Notifications;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Application.Notifications.Dispatching;

/// <summary>
/// Tick step 3 (design section 7): the candidate babies (a member with a kind on, Owner or Parent, with an active
/// subscription), each planned by the pure <see cref="NotificationPlanner"/> with the recipients' settings, their
/// snoozes and dismissals and the keys already claimed for them. A baby whose data cannot be planned is logged and
/// skipped so the other babies still get their reminders.
/// </summary>
internal sealed class NotificationPlanningPass(
    IBabyNotificationPreferencesRepository preferences,
    IUserNotificationSettingsRepository settings,
    INotificationDeliveryRepository deliveries,
    NotificationPlanInputLoader loader,
    PushMetrics metrics,
    ILogger<NotificationPlanningPass> logger)
{
    /// <summary>
    /// How far back claimed keys are read: longer than any reminder can be planned after its send time (stale cutoffs
    /// of 15-30 minutes, snooze re-sends within the 12 hour action window).
    /// </summary>
    public static readonly TimeSpan ClaimedKeysLookBack = TimeSpan.FromDays(1);

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
        var planned = new List<PlannedNotification>();
        foreach (var baby in candidates.GroupBy(candidate => candidate.BabyId))
        {
            planned.AddRange(await PlanBabyAsync(baby.Key, baby.ToArray(), settingsByUser, delivered, now, cancellationToken));
        }

        return planned;
    }

    private async Task<IReadOnlyList<PlannedNotification>> PlanBabyAsync(
        Guid babyId,
        IReadOnlyList<NotificationCandidate> candidates,
        IReadOnlyDictionary<Guid, UserNotificationSettings> settingsByUser,
        IReadOnlyCollection<DeliveredNotification> delivered,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        try
        {
            var recipients = candidates
                .Select(candidate => NotificationRecipient.From(candidate.UserId, candidate.Role, candidate.Preferences, settingsByUser.GetValueOrDefault(candidate.UserId), now))
                .ToArray();
            var plan = NotificationPlanner.Plan(await loader.LoadAsync(babyId, recipients, delivered, now, cancellationToken));
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
