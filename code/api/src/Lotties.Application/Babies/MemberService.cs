using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Users;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Babies;

internal sealed class MemberService : IMemberService
{
    private readonly IBabyRepository _babies;
    private readonly IUserRepository _users;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<MemberService> _logger;

    public MemberService(IBabyRepository babies, IUserRepository users, ICurrentUser currentUser, ILogger<MemberService> logger)
    {
        _babies = babies ?? throw new ArgumentNullException(nameof(babies));
        _users = users ?? throw new ArgumentNullException(nameof(users));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<MemberResponse>> ListAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var baby = await LoadAsync(babyId, cancellationToken);
        var users = await LoadUsersAsync(baby.Members, cancellationToken);
        return baby.Members
            .OrderBy(member => member.JoinedAt)
            .Select(member => MemberResponse.For(member, users.GetValueOrDefault(member.UserId)))
            .ToArray();
    }

    public async Task<MemberResponse> ChangeRoleAsync(Guid babyId, Guid userId, ChangeMemberRoleRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var baby = await LoadAsync(babyId, cancellationToken);
        var member = baby.ChangeMemberRole(userId, request.Role);
        await _babies.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Member {UserId} of baby {BabyId} is now {Role}", userId, babyId, member.Role);
        var users = await LoadUsersAsync([member], cancellationToken);
        return MemberResponse.For(member, users.GetValueOrDefault(userId));
    }

    public async Task RemoveAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default)
    {
        var baby = await LoadAsync(babyId, cancellationToken);
        baby.RemoveMember(userId);
        await _babies.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Member {UserId} was removed from baby {BabyId}", userId, babyId);
    }

    public async Task LeaveAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        await RemoveAsync(babyId, user.Id, cancellationToken);
    }

    private async Task<Baby> LoadAsync(Guid babyId, CancellationToken cancellationToken) =>
        await _babies.FindAsync(babyId, cancellationToken) ?? throw new BabyNotFoundException(babyId);

    private async Task<IReadOnlyDictionary<Guid, User>> LoadUsersAsync(IEnumerable<BabyMember> members, CancellationToken cancellationToken)
    {
        var ids = members.Select(member => member.UserId).Distinct().ToArray();
        var users = await _users.FindByIdsAsync(ids, cancellationToken);
        return users.ToDictionary(user => user.Id);
    }
}
