using Lotties.Api.Authorization;

namespace Lotties.Api.Endpoints;

/// <summary>The route group for resources that belong to one baby: <c>/api/v1/babies/{babyId}/...</c>.</summary>
public static class BabyRoutes
{
    public const string BabyIdParameter = "babyId";

    public const string Prefix = "/babies/{" + BabyIdParameter + ":guid}";

    /// <summary>
    /// Maps the baby-scoped group under <paramref name="api"/>. The group requires <see cref="BabyPolicies.Read"/>;
    /// endpoints that change data add <see cref="BabyPolicies.Log"/> (events, own reminder preferences),
    /// <see cref="BabyPolicies.Write"/>, <see cref="BabyPolicies.Measure"/>, <see cref="BabyPolicies.Note"/> or
    /// <see cref="BabyPolicies.ManageMembers"/>. Every authorized <c>GET</c> of a Doctor is recorded in the baby's access
    /// log (<see cref="AccessLogEndpoints.RecordDoctorAccess"/>, at most hourly).
    /// </summary>
    public static RouteGroupBuilder MapBabyScopedGroup(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        var group = api.MapGroup(Prefix).RequireAuthorization(BabyPolicies.Read);
        group.AddEndpointFilter(AccessLogEndpoints.RecordDoctorAccess);
        return group;
    }
}
