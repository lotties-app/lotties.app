namespace BabyRoutine.Domain.Users;

/// <summary>Persistence for <see cref="User"/>.</summary>
public interface IUserRepository
{
    Task<User?> FindBySubjectAsync(string subject, CancellationToken cancellationToken = default);

    /// <summary>
    /// Saves <paramref name="user"/>. When another request saved a user with the same subject first,
    /// returns that existing user instead, so concurrent first requests resolve to a single row.
    /// </summary>
    Task<User> AddOrGetExistingAsync(User user, CancellationToken cancellationToken = default);
}
