using Lotties.Domain.Babies;
using Microsoft.AspNetCore.Authorization;

namespace Lotties.Api.Authorization;

/// <summary>
/// Requires the caller's membership on the route's baby to open the <see cref="Scope"/> section (<see cref="BabyAccess.DecideScope"/>):
/// every member but a Doctor passes, a Doctor only when her scopes include it; with no scope no Doctor passes (the
/// family-only routes use <see cref="BabyPolicies.ReadFamily"/>). Added on top of the role requirement
/// (<see cref="BabyAccessRequirement"/>).
/// </summary>
public sealed class BabyScopeRequirement(DoctorScope? scope) : IAuthorizationRequirement
{
    /// <summary>The section a Doctor needs, or <c>null</c> when no Doctor may call the route.</summary>
    public DoctorScope? Scope { get; } = scope;
}
