using BabyRoutine.Domain.Users;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Application.Users;

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
        var existing = await _users.FindBySubjectAsync(identity.Subject, cancellationToken);
        return existing ?? await RegisterAsync(identity, cancellationToken);
    }

    private async Task<User> RegisterAsync(ExternalIdentity identity, CancellationToken cancellationToken)
    {
        var candidate = User.Register(identity, _timeProvider.GetUtcNow());
        var user = await _users.AddOrGetExistingAsync(candidate, cancellationToken);
        _logger.LogInformation("Provisioned user {UserId} on first sign-in", user.Id);
        return user;
    }
}
