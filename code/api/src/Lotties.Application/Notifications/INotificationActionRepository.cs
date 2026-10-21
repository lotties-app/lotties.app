using Lotties.Domain.Notifications;

namespace Lotties.Application.Notifications;

/// <summary>Persistence for <see cref="NotificationAction"/> (per-user snoozes and dismissals).</summary>
public interface INotificationActionRepository
{
    /// <summary>The user's action on <paramref name="baseKey"/>, or <c>null</c>; tracked.</summary>
    Task<NotificationAction?> FindAsync(Guid userId, NotificationKey baseKey, CancellationToken cancellationToken = default);

    /// <summary>The actions of these users on the baby's reminders (planner input); not tracked.</summary>
    Task<IReadOnlyList<NotificationAction>> ListForBabyAsync(Guid babyId, IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default);

    /// <summary>Saves a user's first action on a reminder. Returns <c>false</c>, leaving nothing tracked, when a concurrent request saved one first.</summary>
    Task<bool> TryAddAsync(NotificationAction action, CancellationToken cancellationToken = default);

    /// <summary>Housekeeping: deletes actions last changed before <paramref name="updatedBefore"/>; returns how many.</summary>
    Task<int> DeleteUpdatedBeforeAsync(DateTimeOffset updatedBefore, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
