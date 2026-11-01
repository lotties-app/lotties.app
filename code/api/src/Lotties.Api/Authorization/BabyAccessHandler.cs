using Lotties.Api.Endpoints;
using Lotties.Application.Babies;
using Lotties.Domain.Babies;
using Microsoft.AspNetCore.Authorization;

namespace Lotties.Api.Authorization;

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

        if (context.Resource is not HttpContext httpContext || BabyRouteValues.ReadBabyId(httpContext) is not { } babyId)
        {
            logger.LogWarning("Baby access requirement evaluated on a route without a valid {RouteParameter}", BabyRoutes.BabyIdParameter);
            context.Fail(new AuthorizationFailureReason(this, MissingBabyIdMessage));
            return;
        }

        var decision = await DecideAsync(babyId, requirement, httpContext.RequestAborted);
        ApplyDecision(context, requirement, decision);
    }

    /// <summary>The first accepted role that grants access wins; a non-member is refused at once.</summary>
    private async Task<BabyAccessDecision> DecideAsync(Guid babyId, BabyAccessRequirement requirement, CancellationToken cancellationToken)
    {
        var decision = BabyAccessDecision.InsufficientRole;
        foreach (var role in requirement.AcceptedRoles.TakeWhile(_ => decision == BabyAccessDecision.InsufficientRole))
        {
            decision = await babyAccess.CheckAsync(babyId, role, cancellationToken);
        }

        return decision;
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
}
