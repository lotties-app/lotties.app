namespace Lotties.Domain.Units;

/// <summary>Persistence for <see cref="UserUnitSettings"/> (one row per user, absent until the first PUT).</summary>
public interface IUserUnitSettingsRepository
{
    /// <summary>The user's stored setting, or <c>null</c> before the first PUT; tracked.</summary>
    Task<UserUnitSettings?> FindAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>Saves a user's first setting. Returns <c>false</c>, leaving nothing tracked, when a concurrent PUT saved it first.</summary>
    Task<bool> TryAddAsync(UserUnitSettings settings, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
