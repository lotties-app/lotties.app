using Lotties.Application.Users;
using Lotties.Domain.Users;

namespace Lotties.Api.Authentication;

/// <summary>
/// A synthetic current user for unauthenticated local/self-hosted deployments. Returns a fixed local user
/// without requiring OIDC authentication, enabling single-user operation without registration or sign-in.
/// Registered instead of <see cref="HttpCurrentUser"/> when ASPNETCORE_ENVIRONMENT is "Local".
/// </summary>
internal sealed class LocalCurrentUser(IUserProvisioningService provisioning) : ICurrentUser
{
    /// <summary>Well-known subject identifier for the local synthetic user.</summary>
    public const string LocalSubject = "local-self-hosted-user";

    /// <summary>Well-known issuer for the local synthetic user.</summary>
    public const string LocalIssuer = "local";

    private User? _user;

    public bool IsAuthenticated => true;

    public async Task<User> GetUserAsync(CancellationToken cancellationToken = default) =>
        _user ??= await provisioning.EnsureUserAsync(
            new ExternalIdentity(LocalIssuer, LocalSubject, Name: "Local User"),
            cancellationToken);
}