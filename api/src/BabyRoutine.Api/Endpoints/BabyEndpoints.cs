using BabyRoutine.Api.Authorization;
using BabyRoutine.Application.Babies;
using Microsoft.AspNetCore.Http.HttpResults;

namespace BabyRoutine.Api.Endpoints;

/// <summary>
/// Babies of the current user. The collection routes need only a signed-in user; the single-baby routes need
/// <see cref="BabyPolicies.Read"/> (from the baby group), and renaming needs <see cref="BabyPolicies.ManageMembers"/> (owner).
/// Deleting a baby is not supported in the MVP (no route, so 405).
/// </summary>
internal static class BabyEndpoints
{
    private const string BabiesPath = "/babies";

    /// <summary>Maps <c>GET /babies</c> and <c>POST /babies</c> under the API group.</summary>
    public static IEndpointRouteBuilder MapBabyCollectionEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        api.MapGet(BabiesPath, ListAsync).WithName("ListBabies");
        api.MapPost(BabiesPath, CreateAsync)
            .WithName("CreateBaby")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        return api;
    }

    /// <summary>Maps <c>GET</c> and <c>PUT /babies/{babyId}</c> under the baby-scoped group.</summary>
    public static RouteGroupBuilder MapBabyEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(string.Empty, GetAsync).WithName("GetBaby");
        baby.MapPut(string.Empty, UpdateAsync)
            .RequireAuthorization(BabyPolicies.ManageMembers)
            .WithName("UpdateBaby")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        return baby;
    }

    private static async Task<Ok<IReadOnlyList<BabyResponse>>> ListAsync(IBabyService babies, CancellationToken cancellationToken) =>
        TypedResults.Ok(await babies.ListAsync(cancellationToken));

    private static async Task<Created<BabyResponse>> CreateAsync(SaveBabyRequest request, IBabyService babies, CancellationToken cancellationToken)
    {
        var created = await babies.CreateAsync(request, cancellationToken);
        return TypedResults.Created($"{ApiEndpoints.V1Prefix}{BabiesPath}/{created.Id}", created);
    }

    private static async Task<Ok<BabyResponse>> GetAsync(Guid babyId, IBabyService babies, CancellationToken cancellationToken) =>
        TypedResults.Ok(await babies.GetAsync(babyId, cancellationToken));

    private static async Task<Ok<BabyResponse>> UpdateAsync(Guid babyId, SaveBabyRequest request, IBabyService babies, CancellationToken cancellationToken) =>
        TypedResults.Ok(await babies.UpdateAsync(babyId, request, cancellationToken));
}
