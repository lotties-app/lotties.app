using Lotties.Application.Professionals;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Professionals;
using Lotties.Domain.Proposals;
using Lotties.Domain.Users;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Babies;

/// <remarks>
/// When a doctor loses her Doctor access (removed, leaving, or a role change), her pending prescription proposals are
/// cancelled in the same save (docs/design/16-doctor-access.md section 10.1): the repositories share the scoped context,
/// so the membership change and the proposals are saved together by the baby repository.
/// </remarks>
internal sealed class MemberService : IMemberService
{
    private readonly IBabyRepository _babies;
    private readonly IUserRepository _users;
    private readonly IProfessionalProfileRepository _professionals;
    private readonly IPrescriptionProposalRepository _proposals;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<MemberService> _logger;

    public MemberService(
        IBabyRepository babies,
        IUserRepository users,
        IProfessionalProfileRepository professionals,
        IPrescriptionProposalRepository proposals,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<MemberService> logger)
    {
        _babies = babies ?? throw new ArgumentNullException(nameof(babies));
        _users = users ?? throw new ArgumentNullException(nameof(users));
        _professionals = professionals ?? throw new ArgumentNullException(nameof(professionals));
        _proposals = proposals ?? throw new ArgumentNullException(nameof(proposals));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
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

    public async Task<MemberResponse> ChangeAsync(Guid babyId, Guid userId, ChangeMemberRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureSomethingToChange(request);
        var scopes = ScopesOf(request);
        var baby = await LoadAsync(babyId, cancellationToken);
        await ChangeRoleWhenRequestedAsync(baby, userId, request.Role, cancellationToken);
        ChangeScopesWhenRequested(baby, userId, scopes);
        await _babies.SaveChangesAsync(cancellationToken);
        var member = baby.FindMember(userId) ?? throw new MemberNotFoundException(babyId, userId);
        _logger.LogInformation("Member {UserId} of baby {BabyId} is now {Role} (doctor scopes {DoctorScopes})", userId, babyId, member.Role, member.DoctorScopes?.ToStorage());
        var users = await LoadUsersAsync([member], cancellationToken);
        var doctors = await LoadDoctorProfilesAsync([member], cancellationToken);
        return MemberResponse.For(member, users.GetValueOrDefault(userId), doctors.GetValueOrDefault(userId));
    }

    public async Task RemoveAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default)
    {
        var baby = await LoadAsync(babyId, cancellationToken);
        var previousRole = baby.FindMember(userId)?.Role;
        baby.RemoveMember(userId);
        await CancelProposalsWhenDoctorAccessEndsAsync(babyId, userId, previousRole, newRole: null, cancellationToken);
        await _babies.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Member {UserId} was removed from baby {BabyId}", userId, babyId);
    }

    public async Task LeaveAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        await RemoveAsync(babyId, user.Id, cancellationToken);
    }

    private async Task ChangeRoleWhenRequestedAsync(Baby baby, Guid userId, BabyRole? role, CancellationToken cancellationToken)
    {
        if (role is not { } newRole)
        {
            return;
        }

        var isDeclaredProfessional = newRole.RequiresProfessionalProfile() && await _professionals.FindAsync(userId, cancellationToken) is not null;
        var previousRole = baby.FindMember(userId)?.Role;
        var member = baby.ChangeMemberRole(userId, newRole, isDeclaredProfessional);
        await CancelProposalsWhenDoctorAccessEndsAsync(baby.Id, userId, previousRole, member.Role, cancellationToken);
    }

    private static void ChangeScopesWhenRequested(Baby baby, Guid userId, DoctorScopeSet? scopes)
    {
        if (scopes is not null)
        {
            baby.ChangeDoctorScopes(userId, scopes);
        }
    }

    private static DoctorScopeSet? ScopesOf(ChangeMemberRequest request) =>
        request.DoctorScopes is null ? null : DoctorScopeSet.Parse(request.DoctorScopes);

    private static void EnsureSomethingToChange(ChangeMemberRequest request)
    {
        if (request.Role is null && request.DoctorScopes is null)
        {
            throw new DomainValidationException("role", "Send a role, doctorScopes or both.");
        }
    }

    /// <summary>Cancels the member's pending proposals (reason <c>access_removed</c>) when she was a Doctor and no longer is.</summary>
    private async Task CancelProposalsWhenDoctorAccessEndsAsync(Guid babyId, Guid userId, BabyRole? previousRole, BabyRole? newRole, CancellationToken cancellationToken)
    {
        if (previousRole is not BabyRole.Doctor || newRole is BabyRole.Doctor)
        {
            return;
        }

        var pending = await _proposals.ListPendingByAuthorAsync(babyId, userId, cancellationToken);
        var actor = await _currentUser.GetUserAsync(cancellationToken);
        var now = _timeProvider.GetUtcNow();
        var cancelled = pending.Count(proposal => proposal.CancelForAccessRemoved(actor.Id, now));
        _logger.LogInformation("Doctor access of {UserId} to baby {BabyId} ended: {CancelledCount} pending proposals cancelled", userId, babyId, cancelled);
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
