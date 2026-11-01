namespace Lotties.Application.Babies;

/// <summary>Member management of one baby. Callers have already authorized the current user (any member to list or leave, owners otherwise).</summary>
public interface IMemberService
{
    Task<IReadOnlyList<MemberResponse>> ListAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Changes a member's role; throws <see cref="Domain.Exceptions.LastOwnerException"/> when it would demote the last owner.</summary>
    Task<MemberResponse> ChangeRoleAsync(Guid babyId, Guid userId, ChangeMemberRoleRequest request, CancellationToken cancellationToken = default);

    /// <summary>Removes a member; throws <see cref="Domain.Exceptions.LastOwnerException"/> when it would remove the last owner.</summary>
    Task RemoveAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default);

    /// <summary>Removes the current user from the baby (same last-owner rule).</summary>
    Task LeaveAsync(Guid babyId, CancellationToken cancellationToken = default);
}
