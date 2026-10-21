using BabyRoutine.Api.Authorization;

namespace BabyRoutine.Api.Endpoints;

/// <summary>The route group for resources that belong to one baby: <c>/api/v1/babies/{babyId}/...</c>.</summary>
public static class BabyRoutes
{
    public const string BabyIdParameter = "babyId";

    public const string Prefix = "/babies/{" + BabyIdParameter + ":guid}";

    /// <summary>
    /// Maps the baby-scoped group under <paramref name="api"/>. The group requires <see cref="BabyPolicies.Read"/>;
    /// endpoints that change data add <see cref="BabyPolicies.Write"/> or <see cref="BabyPolicies.ManageMembers"/>.
    /// </summary>
    public static RouteGroupBuilder MapBabyScopedGroup(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        return api.MapGroup(Prefix).RequireAuthorization(BabyPolicies.Read);
    }
}
