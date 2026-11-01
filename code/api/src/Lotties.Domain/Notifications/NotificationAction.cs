using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Notifications;

/// <summary>The last thing a user did with a reminder.</summary>
public enum NotificationActionKind
{
    Snoozed,

    /// <summary>"Stop reminders for this dose": pending snooze re-sends are cancelled for this user.</summary>
    Dismissed,
}

/// <summary>
/// A user's snooze or dismissal of one reminder (keyed by user and base key; per user, so it never silences a
/// co-parent). A snooze re-sends after <see cref="NotificationRules.SnoozeLength"/> with the dedupe key
/// <c>{base}:s{n}</c>, at most <see cref="NotificationRules.MaxSnoozes"/> times.
/// </summary>
public sealed class NotificationAction
{
    private NotificationAction()
    {
    }

    private NotificationAction(Guid userId, Guid babyId, NotificationKey baseKey)
    {
        UserId = userId;
        BabyId = babyId;
        BaseKey = baseKey;
    }

    public Guid UserId { get; private set; }

    public NotificationKey BaseKey { get; private set; }

    public Guid BabyId { get; private set; }

    public NotificationActionKind Action { get; private set; }

    /// <summary>When the latest snooze ends; kept after a dismissal so the cancelled re-send can be told apart.</summary>
    public DateTimeOffset? SnoozedUntil { get; private set; }

    public short SnoozeCount { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>The dedupe key of the latest snooze re-send, or <c>null</c> before the first snooze.</summary>
    public NotificationKey? SnoozeResendKey => SnoozeCount > 0 ? BaseKey.Snoozed(SnoozeCount) : null;

    /// <summary>The first snooze of a reminder by this user.</summary>
    public static NotificationAction Snooze(Guid userId, Guid babyId, NotificationKey baseKey, DateTimeOffset now)
    {
        var action = Start(userId, babyId, baseKey);
        action.Snooze(now);
        return action;
    }

    /// <summary>The first action of this user on a reminder is a dismissal.</summary>
    public static NotificationAction Dismiss(Guid userId, Guid babyId, NotificationKey baseKey, DateTimeOffset now)
    {
        var action = Start(userId, babyId, baseKey);
        action.Dismiss(now);
        return action;
    }

    /// <summary>Snoozes again (also after a dismissal); the fourth snooze throws <see cref="SnoozeLimitReachedException"/>.</summary>
    public void Snooze(DateTimeOffset now)
    {
        if (SnoozeCount >= NotificationRules.MaxSnoozes)
        {
            throw new SnoozeLimitReachedException(BaseKey.Value, NotificationRules.MaxSnoozes);
        }

        var at = UtcTime.Normalize(now);
        Action = NotificationActionKind.Snoozed;
        SnoozeCount++;
        SnoozedUntil = at + NotificationRules.SnoozeLength;
        UpdatedAt = at;
    }

    /// <summary>Stops reminders for this item for this user; idempotent.</summary>
    public void Dismiss(DateTimeOffset now)
    {
        if (Action == NotificationActionKind.Dismissed)
        {
            return;
        }

        Action = NotificationActionKind.Dismissed;
        UpdatedAt = UtcTime.Normalize(now);
    }

    private static NotificationAction Start(Guid userId, Guid babyId, NotificationKey baseKey) =>
        new(Ids.Required(userId, nameof(userId)), Ids.Required(babyId, nameof(babyId)), EnsureBaseKey(baseKey));

    private static NotificationKey EnsureBaseKey(NotificationKey key) =>
        key.Value is null || key.IsSnoozeResend
            ? throw new DomainValidationException("key", "A notification action needs a base key.")
            : key;
}
