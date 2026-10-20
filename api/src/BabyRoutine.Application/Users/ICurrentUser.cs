using BabyRoutine.Domain.Users;

namespace BabyRoutine.Application.Users;

/// <summary>The authenticated user of the current request.</summary>
public interface ICurrentUser
{
    /// <summary>Whether the current request carries an authenticated identity.</summary>
    bool IsAuthenticated { get; }

    /// <summary>
    /// The <see cref="User"/> row for the authenticated identity, created on first use.
    /// Throws <see cref="InvalidOperationException"/> when the request is not authenticated.
    /// </summary>
    Task<User> GetUserAsync(CancellationToken cancellationToken = default);
}
