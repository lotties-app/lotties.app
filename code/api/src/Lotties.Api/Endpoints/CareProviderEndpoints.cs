using Lotties.Api.Authorization;
using Lotties.Application.CareProviders;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The directory of a baby's care providers (offline sync: idempotent upsert by client GUID, delta pull). Every route
/// sits in a group that requires <see cref="BabyPolicies.ReadFamily"/> (family members only: a Doctor gets 403 on all
/// of them, routes added later included); Caregivers and Viewers read only; writes, soft delete included, need
/// <see cref="BabyPolicies.Write"/> (Owner, Parent). There is no delete route: <c>isDeleted</c> is the soft delete.
/// </summary>
internal static class CareProviderEndpoints
{
    private const string ProvidersPath = "/care-providers";
    private const string ProviderPath = "/{providerId:guid}";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /care-providers?since=</c> (deleted ones included) and
    /// <c>PUT /care-providers/{providerId}</c> (201 created / 200 otherwise).
    /// </summary>
    public static RouteGroupBuilder MapCareProviderEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        var providers = baby.MapGroup(ProvidersPath).RequireAuthorization(BabyPolicies.ReadFamily);
        providers.MapGet(string.Empty, ListAsync)
            .WithName("ListCareProviders");
        providers.MapPut(ProviderPath, UpsertAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("UpsertCareProvider")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        return baby;
    }

    private static async Task<Ok<IReadOnlyList<CareProviderResponse>>> ListAsync(
        Guid babyId,
        DateTimeOffset? since,
        ICareProviderService providers,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await providers.ListAsync(babyId, since, cancellationToken));

    private static async Task<Results<Created<CareProviderResponse>, Ok<CareProviderResponse>>> UpsertAsync(
        Guid babyId,
        Guid providerId,
        UpsertCareProviderRequest request,
        ICareProviderService providers,
        CancellationToken cancellationToken)
    {
        var result = await providers.UpsertAsync(babyId, providerId, request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}/babies/{babyId}{ProvidersPath}/{providerId}", result.Provider)
            : TypedResults.Ok(result.Provider);
    }
}
