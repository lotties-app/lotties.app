using Lotties.Api.Endpoints;
using Lotties.Application.Babies;
using Lotties.Domain.Babies;
using Microsoft.AspNetCore.Authorization;

namespace Lotties.Api.Authorization;

/// <summary>
/// Evaluates <see cref="BabyScopeRequirement"/> from the <c>{babyId}</c> route value, from the membership read for this
/// request (never cached across requests, so a change of a Doctor's scopes applies to her next call). Anonymous callers
/// are left to the authenticated-user requirement (401); every other failure fails the requirement (403).
/// </summary>
internal sealed class BabyScopeHandler(IBabyAccessService babyAccess, ILogger<BabyScopeHandler> logger)
    : AuthorizationHandler<BabyScopeRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, BabyScopeRequirement requirement)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            return;
        }

        if (context.Resource is not HttpContext httpContext || BabyRouteValues.ReadBabyId(httpContext) is not { } babyId)
        {
            logger.LogWarning("Baby scope requirement evaluated on a route without a valid {RouteParameter}", BabyRoutes.BabyIdParameter);
            context.Fail(new AuthorizationFailureReason(this, BabyAccessHandler.MissingBabyIdMessage));
            return;
        }

        var decision = await babyAccess.CheckScopeAsync(babyId, requirement.Scope, httpContext.RequestAborted);
        ApplyDecision(context, requirement, decision);
    }

    private void ApplyDecision(AuthorizationHandlerContext context, BabyScopeRequirement requirement, BabyAccessDecision decision)
    {
        if (decision == BabyAccessDecision.Granted)
        {
            context.Succeed(requirement);
            return;
        }

        context.Fail(new AuthorizationFailureReason(this, $"Baby scope access denied: {decision}."));
    }
}
