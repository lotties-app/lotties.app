using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Babies;

internal sealed class BabyAccessService : IBabyAccessService
{
    private readonly ICurrentUser _currentUser;
    private readonly IBabyMembershipRepository _memberships;
    private readonly ILogger<BabyAccessService> _logger;

    public BabyAccessService(ICurrentUser currentUser, IBabyMembershipRepository memberships, ILogger<BabyAccessService> logger)
    {
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _memberships = memberships ?? throw new ArgumentNullException(nameof(memberships));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<BabyAccessDecision> CheckAsync(Guid babyId, BabyRole requiredRole, CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var member = await _memberships.FindAsync(babyId, user.Id, cancellationToken);
        var decision = BabyAccess.Decide(member, requiredRole);
        _logger.LogDebug(
            "Access to baby {BabyId} for user {UserId} requiring {RequiredRole}: {Decision}",
            babyId,
            user.Id,
            requiredRole,
            decision);
        return decision;
    }
}
