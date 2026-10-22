using Lotties.Domain.Babies;
using Microsoft.AspNetCore.Authorization;

namespace Lotties.Api.Authorization;

/// <summary>Requires the caller's membership on the route's baby to satisfy <see cref="RequiredRole"/> (Owner &gt; Parent &gt; Caregiver &gt; Viewer).</summary>
public sealed class BabyAccessRequirement(BabyRole requiredRole) : IAuthorizationRequirement
{
    public BabyRole RequiredRole { get; } = requiredRole;
}
