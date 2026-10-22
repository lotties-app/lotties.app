using Lotties.Domain.Babies;
using Microsoft.AspNetCore.Authorization;

namespace Lotties.Api.Authorization;

internal static class AuthorizationServiceCollectionExtensions
{
    /// <summary>
    /// Registers the baby-scoped policies (<see cref="BabyPolicies"/>) and makes authentication the fallback,
    /// so endpoints are protected unless they opt out with <c>AllowAnonymous()</c>.
    /// </summary>
    public static IServiceCollection AddBabyAuthorization(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.AddScoped<IAuthorizationHandler, BabyAccessHandler>();
        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
            .AddPolicy(BabyPolicies.Read, policy => RequireBabyRole(policy, BabyRole.Viewer))
            .AddPolicy(BabyPolicies.Log, policy => RequireBabyRole(policy, BabyRole.Caregiver))
            .AddPolicy(BabyPolicies.Write, policy => RequireBabyRole(policy, BabyRole.Parent))
            .AddPolicy(BabyPolicies.ManageMembers, policy => RequireBabyRole(policy, BabyRole.Owner))
            .AddPolicy(BabyPolicies.Note, policy => RequireBabyRole(policy, BabyRole.Doctor))
            .AddPolicy(BabyPolicies.Measure, policy => RequireBabyRole(policy, BabyRole.Parent, BabyRole.Doctor));
        return services;
    }

    private static void RequireBabyRole(AuthorizationPolicyBuilder policy, BabyRole requiredRole, params BabyRole[] alternativeRoles) =>
        policy.RequireAuthenticatedUser().AddRequirements(new BabyAccessRequirement(requiredRole, alternativeRoles));
}
