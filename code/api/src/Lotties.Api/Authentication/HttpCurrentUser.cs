using Lotties.Application.Users;
using Lotties.Domain.Users;

namespace Lotties.Api.Authentication;

/// <summary>Resolves the request's OIDC identity to a <see cref="User"/> once per request, creating the row on first sign-in.</summary>
internal sealed class HttpCurrentUser(IHttpContextAccessor httpContextAccessor, IUserProvisioningService provisioning) : ICurrentUser
{
    private User? _user;

    public bool IsAuthenticated => Identity is not null;

    private ExternalIdentity? Identity => httpContextAccessor.HttpContext?.User.ToExternalIdentity();

    public async Task<User> GetUserAsync(CancellationToken cancellationToken = default) =>
        _user ??= await provisioning.EnsureUserAsync(RequireIdentity(), cancellationToken);

    private ExternalIdentity RequireIdentity() =>
        Identity ?? throw new InvalidOperationException("The current request has no authenticated identity with a sub claim.");
}
