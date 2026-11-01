using Lotties.Domain.Babies;

namespace Lotties.Application.Babies;

/// <summary>Checks the current user's access to a baby.</summary>
public interface IBabyAccessService
{
    /// <summary>Decides whether the current user's membership on <paramref name="babyId"/> satisfies <paramref name="requiredRole"/>.</summary>
    Task<BabyAccessDecision> CheckAsync(Guid babyId, BabyRole requiredRole, CancellationToken cancellationToken = default);

    /// <summary>
    /// Decides whether the current user may reach the <paramref name="scope"/> section of <paramref name="babyId"/>
    /// (<see cref="BabyAccess.DecideScope"/>): any member but a Doctor, and a Doctor whose scopes include it. A
    /// <c>null</c> scope is a section no Doctor reaches.
    /// </summary>
    Task<BabyAccessDecision> CheckScopeAsync(Guid babyId, DoctorScope? scope, CancellationToken cancellationToken = default);

    /// <summary>The current user's role on <paramref name="babyId"/>, or <c>null</c> when she is not a member.</summary>
    Task<BabyRole?> FindRoleAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The current user's membership on <paramref name="babyId"/> (role and doctor scopes), or <c>null</c> when she is not
    /// a member. Read from the database once per request, never cached across requests, so a change of scopes applies at once.
    /// </summary>
    Task<BabyMember?> FindMembershipAsync(Guid babyId, CancellationToken cancellationToken = default);
}
