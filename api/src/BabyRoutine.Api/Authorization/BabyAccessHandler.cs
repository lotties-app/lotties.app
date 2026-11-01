using BabyRoutine.Api.Endpoints;
using BabyRoutine.Application.Babies;
using BabyRoutine.Domain.Babies;
using Microsoft.AspNetCore.Authorization;

namespace BabyRoutine.Api.Authorization;

/// <summary>
/// Evaluates <see cref="BabyAccessRequirement"/> from the <c>{babyId}</c> route value. Anonymous callers are left to
/// the authenticated-user requirement (401); every other failure fails the requirement (403).
/// </summary>
internal sealed class BabyAccessHandler(IBabyAccessService babyAccess, ILogger<BabyAccessHandler> logger)
    : AuthorizationHandler<BabyAccessRequirement>
{
    public const string MissingBabyIdMessage = "The route has no valid babyId.";

    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, BabyAccessRequirement requirement)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            return;
        }

        if (context.Resource is not HttpContext httpContext || ReadBabyId(httpContext) is not { } babyId)
        {
            logger.LogWarning("Baby access requirement evaluated on a route without a valid {RouteParameter}", BabyRoutes.BabyIdParameter);
            context.Fail(new AuthorizationFailureReason(this, MissingBabyIdMessage));
            return;
        }

        var decision = await babyAccess.CheckAsync(babyId, requirement.RequiredRole, httpContext.RequestAborted);
        ApplyDecision(context, requirement, decision);
    }

    private void ApplyDecision(AuthorizationHandlerContext context, BabyAccessRequirement requirement, BabyAccessDecision decision)
    {
        if (decision == BabyAccessDecision.Granted)
        {
            context.Succeed(requirement);
            return;
        }

        context.Fail(new AuthorizationFailureReason(this, $"Baby access denied: {decision}."));
    }

    private static Guid? ReadBabyId(HttpContext httpContext) =>
        Guid.TryParse(httpContext.GetRouteValue(BabyRoutes.BabyIdParameter)?.ToString(), out var babyId) ? babyId : null;
}
