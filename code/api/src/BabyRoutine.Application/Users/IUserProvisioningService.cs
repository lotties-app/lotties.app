using BabyRoutine.Domain.Users;

namespace BabyRoutine.Application.Users;

/// <summary>Maps an external OIDC identity to a <see cref="User"/> row.</summary>
public interface IUserProvisioningService
{
    /// <summary>Returns the user for <paramref name="identity"/>, creating it on first sign-in. Idempotent and safe under concurrency.</summary>
    Task<User> EnsureUserAsync(ExternalIdentity identity, CancellationToken cancellationToken = default);
}
