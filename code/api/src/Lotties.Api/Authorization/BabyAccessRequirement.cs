using Lotties.Domain.Babies;
using Microsoft.AspNetCore.Authorization;

namespace Lotties.Api.Authorization;

/// <summary>
/// Requires the caller's membership on the route's baby to satisfy <see cref="RequiredRole"/> (Owner &gt; Parent &gt;
/// Caregiver &gt; Viewer; Doctor outside that order, see <see cref="BabyRoleRules.Satisfies"/>) or, when given, one of
/// <see cref="AlternativeRoles"/> (e.g. Parent or Doctor for consultation measurements).
/// </summary>
public sealed class BabyAccessRequirement(BabyRole requiredRole, params BabyRole[] alternativeRoles) : IAuthorizationRequirement
{
    public BabyRole RequiredRole { get; } = requiredRole;

    public IReadOnlyList<BabyRole> AlternativeRoles { get; } = alternativeRoles;

    /// <summary><see cref="RequiredRole"/> first, then <see cref="AlternativeRoles"/>.</summary>
    public IEnumerable<BabyRole> AcceptedRoles => AlternativeRoles.Prepend(RequiredRole);
}
