namespace Lotties.Domain.Rest;

/// <summary>Persistence for <see cref="UserRestSettings"/> and <see cref="UserRestMorning"/> (the caller's own rows only).</summary>
public interface IUserRestRepository
{
    /// <summary>The user's stored settings, or <c>null</c> before the first PUT; tracked.</summary>
    Task<UserRestSettings?> FindSettingsAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>Saves a user's first settings. Returns <c>false</c>, leaving nothing tracked, when a concurrent PUT saved them first.</summary>
    Task<bool> TryAddSettingsAsync(UserRestSettings settings, CancellationToken cancellationToken = default);

    /// <summary>The user's answer for a night, or <c>null</c>; tracked.</summary>
    Task<UserRestMorning?> FindMorningAsync(Guid userId, DateOnly night, CancellationToken cancellationToken = default);

    /// <summary>Saves a first answer for a night. Returns <c>false</c>, leaving nothing tracked, when a concurrent PUT saved it first.</summary>
    Task<bool> TryAddMorningAsync(UserRestMorning morning, CancellationToken cancellationToken = default);

    /// <summary>Removes the user's settings and every morning answer.</summary>
    Task DeleteAllAsync(Guid userId, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
