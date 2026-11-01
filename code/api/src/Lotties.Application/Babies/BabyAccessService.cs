using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Babies;

/// <remarks>
/// Scoped per request: the current user's membership of a baby is loaded once and reused, so a policy that accepts
/// several roles and the endpoint filters after it (the access log) cost one lookup.
/// </remarks>
internal sealed class BabyAccessService : IBabyAccessService
{
    private readonly ICurrentUser _currentUser;
    private readonly IBabyMembershipRepository _memberships;
    private readonly ILogger<BabyAccessService> _logger;
    private readonly Dictionary<Guid, BabyMember?> _membershipByBaby = [];

    public BabyAccessService(ICurrentUser currentUser, IBabyMembershipRepository memberships, ILogger<BabyAccessService> logger)
    {
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _memberships = memberships ?? throw new ArgumentNullException(nameof(memberships));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<BabyAccessDecision> CheckAsync(Guid babyId, BabyRole requiredRole, CancellationToken cancellationToken = default)
    {
        var member = await FindMembershipAsync(babyId, cancellationToken);
        var decision = BabyAccess.Decide(member, requiredRole);
        _logger.LogDebug(
            "Access to baby {BabyId} for user {UserId} requiring {RequiredRole}: {Decision}",
            babyId,
            member?.UserId,
            requiredRole,
            decision);
        return decision;
    }

    public async Task<BabyRole?> FindRoleAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        (await FindMembershipAsync(babyId, cancellationToken))?.Role;

    private async Task<BabyMember?> FindMembershipAsync(Guid babyId, CancellationToken cancellationToken)
    {
        if (_membershipByBaby.TryGetValue(babyId, out var known))
        {
            return known;
        }

        var user = await _currentUser.GetUserAsync(cancellationToken);
        var member = await _memberships.FindAsync(babyId, user.Id, cancellationToken);
        _membershipByBaby[babyId] = member;
        return member;
    }
}
