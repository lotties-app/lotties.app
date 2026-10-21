namespace BabyRoutine.Domain.Users;

/// <summary>Persistence for <see cref="User"/>.</summary>
public interface IUserRepository
{
    /// <summary>The (tracked) user with this OIDC issuer and subject, or <c>null</c>.</summary>
    Task<User?> FindByIdentityAsync(string issuer, string subject, CancellationToken cancellationToken = default);

    /// <summary>The users with the given ids; unknown ids are skipped; not tracked.</summary>
    Task<IReadOnlyList<User>> FindByIdsAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default);

    /// <summary>
    /// Saves <paramref name="user"/>. When another request saved a user with the same issuer and subject first,
    /// returns that existing user instead, so concurrent first requests resolve to a single row.
    /// </summary>
    Task<User> AddOrGetExistingAsync(User user, CancellationToken cancellationToken = default);

    /// <summary>Saves changes made to tracked users.</summary>
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
