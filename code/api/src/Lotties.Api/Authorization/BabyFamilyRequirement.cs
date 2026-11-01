using Lotties.Domain.Babies;
using Microsoft.AspNetCore.Authorization;

namespace Lotties.Api.Authorization;

/// <summary>
/// Requires the caller's membership on the route's baby to be a family role (<see cref="BabyRoleRules.CanReadFamilyRecords"/>:
/// Owner, Parent, Caregiver or Viewer, never the Doctor). Used for the family's non-clinical records (appointments, the
/// members list), on top of the group's <see cref="BabyPolicies.Read"/>.
/// </summary>
public sealed class BabyFamilyRequirement : IAuthorizationRequirement;
