using BabyRoutine.Domain.Notifications;

namespace BabyRoutine.Application.Notifications;

/// <summary>Persistence for <see cref="UserNotificationSettings"/> (one row per user, absent until the first PUT).</summary>
public interface IUserNotificationSettingsRepository
{
    /// <summary>The user's stored settings, or <c>null</c> before the first PUT; tracked.</summary>
    Task<UserNotificationSettings?> FindAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>The stored settings of these users (users without a row are absent); not tracked.</summary>
    Task<IReadOnlyList<UserNotificationSettings>> ListForUsersAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default);

    /// <summary>Saves a user's first settings. Returns <c>false</c>, leaving nothing tracked, when a concurrent PUT saved them first.</summary>
    Task<bool> TryAddAsync(UserNotificationSettings settings, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
