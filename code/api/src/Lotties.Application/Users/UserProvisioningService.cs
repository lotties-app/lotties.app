using Lotties.Domain.Users;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Users;

/// <remarks>
/// Users are found by <c>(issuer, subject)</c>. A user stored before issuers were recorded (issuer
/// <see cref="User.UnknownIssuer"/>) is claimed by the first sign-in with the same subject, which records the token's
/// issuer; only then is a new user registered.
/// </remarks>
internal sealed class UserProvisioningService : IUserProvisioningService
{
    private readonly IUserRepository _users;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<UserProvisioningService> _logger;

    public UserProvisioningService(IUserRepository users, TimeProvider timeProvider, ILogger<UserProvisioningService> logger)
    {
        _users = users ?? throw new ArgumentNullException(nameof(users));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<User> EnsureUserAsync(ExternalIdentity identity, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(identity);
        var existing = await _users.FindByIdentityAsync(identity.Issuer, identity.Subject, cancellationToken)
            ?? await ClaimUserWithUnknownIssuerAsync(identity, cancellationToken);
        return existing ?? await RegisterAsync(identity, cancellationToken);
    }

    private async Task<User?> ClaimUserWithUnknownIssuerAsync(ExternalIdentity identity, CancellationToken cancellationToken)
    {
        if (identity.Issuer == User.UnknownIssuer)
        {
            return null;
        }

        var unclaimed = await _users.FindByIdentityAsync(User.UnknownIssuer, identity.Subject, cancellationToken);
        if (unclaimed is null)
        {
            return null;
        }

        unclaimed.ClaimIssuer(identity.Issuer);
        await _users.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Recorded the issuer of user {UserId} on sign-in", unclaimed.Id);
        return unclaimed;
    }

    private async Task<User> RegisterAsync(ExternalIdentity identity, CancellationToken cancellationToken)
    {
        var candidate = User.Register(identity, _timeProvider.GetUtcNow());
        var user = await _users.AddOrGetExistingAsync(candidate, cancellationToken);
        _logger.LogInformation("Provisioned user {UserId} on first sign-in", user.Id);
        return user;
    }
}
