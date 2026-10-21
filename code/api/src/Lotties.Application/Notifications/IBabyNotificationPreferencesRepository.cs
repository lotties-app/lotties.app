using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;

namespace Lotties.Application.Notifications;

/// <summary>A member who opted into a reminder kind for a baby, may receive it (Owner or Parent) and has an active subscription.</summary>
public sealed record NotificationCandidate(Guid BabyId, Guid UserId, BabyRole Role, ReminderPreferences Preferences);

/// <summary>Persistence for <see cref="BabyNotificationPreferences"/> (rows are deleted with the membership).</summary>
public interface IBabyNotificationPreferencesRepository
{
    /// <summary>The member's stored preferences for the baby, or <c>null</c> (defaults apply); tracked.</summary>
    Task<BabyNotificationPreferences?> FindAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default);

    /// <summary>The user's stored preferences for every baby they changed anything for; not tracked.</summary>
    Task<IReadOnlyList<BabyNotificationPreferences>> ListForUserAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The scheduler's candidates: stored preferences with a kind on, of current members who may receive reminders
    /// (<see cref="NotificationRules.CanReceive"/>) and have a subscription active at <paramref name="now"/>; by baby, then user.
    /// </summary>
    Task<IReadOnlyList<NotificationCandidate>> ListCandidatesAsync(DateTimeOffset now, CancellationToken cancellationToken = default);

    /// <summary>Saves a member's first preferences. Returns <c>false</c>, leaving nothing tracked, when a concurrent PUT saved them first.</summary>
    Task<bool> TryAddAsync(BabyNotificationPreferences preferences, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
