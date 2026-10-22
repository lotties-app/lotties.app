using Lotties.Application.Professionals;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Professionals;
using Lotties.Domain.Users;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Babies;

internal sealed class MemberService : IMemberService
{
    private readonly IBabyRepository _babies;
    private readonly IUserRepository _users;
    private readonly IProfessionalProfileRepository _professionals;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<MemberService> _logger;

    public MemberService(
        IBabyRepository babies,
        IUserRepository users,
        IProfessionalProfileRepository professionals,
        ICurrentUser currentUser,
        ILogger<MemberService> logger)
    {
        _babies = babies ?? throw new ArgumentNullException(nameof(babies));
        _users = users ?? throw new ArgumentNullException(nameof(users));
        _professionals = professionals ?? throw new ArgumentNullException(nameof(professionals));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<MemberResponse>> ListAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var baby = await LoadAsync(babyId, cancellationToken);
        var users = await LoadUsersAsync(baby.Members, cancellationToken);
        var doctors = await LoadDoctorProfilesAsync(baby.Members, cancellationToken);
        return baby.Members
            .OrderBy(member => member.JoinedAt)
            .Select(member => MemberResponse.For(member, users.GetValueOrDefault(member.UserId), doctors.GetValueOrDefault(member.UserId)))
            .ToArray();
    }

    public async Task<MemberResponse> ChangeRoleAsync(Guid babyId, Guid userId, ChangeMemberRoleRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var baby = await LoadAsync(babyId, cancellationToken);
        var isDeclaredProfessional = request.Role.RequiresProfessionalProfile() && await _professionals.FindAsync(userId, cancellationToken) is not null;
        var member = baby.ChangeMemberRole(userId, request.Role, isDeclaredProfessional);
        await _babies.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Member {UserId} of baby {BabyId} is now {Role}", userId, babyId, member.Role);
        var users = await LoadUsersAsync([member], cancellationToken);
        var doctors = await LoadDoctorProfilesAsync([member], cancellationToken);
        return MemberResponse.For(member, users.GetValueOrDefault(userId), doctors.GetValueOrDefault(userId));
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

    private async Task<IReadOnlyDictionary<Guid, ProfessionalProfile>> LoadDoctorProfilesAsync(IEnumerable<BabyMember> members, CancellationToken cancellationToken)
    {
        var doctorIds = members.Where(member => member.Role.IsDoctor()).Select(member => member.UserId).ToArray();
        var profiles = doctorIds.Length == 0 ? [] : await _professionals.FindManyAsync(doctorIds, cancellationToken);
        return profiles.ToDictionary(profile => profile.UserId);
    }

    private async Task<IReadOnlyDictionary<Guid, User>> LoadUsersAsync(IEnumerable<BabyMember> members, CancellationToken cancellationToken)
    {
        var ids = members.Select(member => member.UserId).Distinct().ToArray();
        var users = await _users.FindByIdsAsync(ids, cancellationToken);
        return users.ToDictionary(user => user.Id);
    }
}
