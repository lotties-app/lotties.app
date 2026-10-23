using Lotties.Api.Endpoints;
using Lotties.Application.Babies;
using Lotties.Domain.Babies;
using Microsoft.AspNetCore.Authorization;

namespace Lotties.Api.Authorization;

/// <summary>
/// Evaluates <see cref="BabyFamilyRequirement"/> from the <c>{babyId}</c> route value: a member whose role is a family
/// role passes; a Doctor, a non-member or a route without a baby fails (403). Anonymous callers are left to the
/// authenticated-user requirement (401). The membership lookup is shared with <see cref="BabyAccessHandler"/> (scoped).
/// </summary>
internal sealed class BabyFamilyHandler(IBabyAccessService babyAccess, ILogger<BabyFamilyHandler> logger)
    : AuthorizationHandler<BabyFamilyRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, BabyFamilyRequirement requirement)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            return;
        }

        if (context.Resource is not HttpContext httpContext || BabyRouteValues.ReadBabyId(httpContext) is not { } babyId)
        {
            logger.LogWarning("Baby family requirement evaluated on a route without a valid {RouteParameter}", BabyRoutes.BabyIdParameter);
            context.Fail(new AuthorizationFailureReason(this, BabyAccessHandler.MissingBabyIdMessage));
            return;
        }

        var role = await babyAccess.FindRoleAsync(babyId, httpContext.RequestAborted);
        ApplyDecision(context, requirement, role);
    }

    private void ApplyDecision(AuthorizationHandlerContext context, BabyFamilyRequirement requirement, BabyRole? role)
    {
        if (role is { } member && member.CanReadFamilyRecords())
        {
            context.Succeed(requirement);
            return;
        }

        context.Fail(new AuthorizationFailureReason(this, $"Baby family records denied for role {role?.ToString() ?? "none"}."));
    }
}
