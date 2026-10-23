namespace Lotties.Domain.Assistants;

/// <summary>Persistence for <see cref="UserAssistantSettings"/> (one row per user, absent until the first PUT).</summary>
public interface IUserAssistantSettingsRepository
{
    /// <summary>The user's stored settings, or <c>null</c> before the first PUT; tracked.</summary>
    Task<UserAssistantSettings?> FindAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>Saves a user's first settings. Returns <c>false</c>, leaving nothing tracked, when a concurrent PUT saved them first.</summary>
    Task<bool> TryAddAsync(UserAssistantSettings settings, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
