using Lotties.Api.Authorization;
using Lotties.Api.CommunityInsights;
using Lotties.Application.CommunityInsights;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// A baby's community insights consent (docs/design/34-community-insights.md section 3, task T2), under
/// <c>/babies/{babyId}/community-consent</c>: only the record and its management, nothing is collected or published. Both routes need an
/// Owner or a Parent (<see cref="BabyPolicies.Write"/>: Caregiver, Viewer and Doctor get 403; a Doctor neither consents nor sees the
/// state, whatever her scopes), answer a bare 404 while <c>CommunityInsights:Enabled</c> is off (<see cref="CommunityInsightsRequestGuard"/>,
/// before any 401), are behind the consent gate and are blocked in the try-it demo. They do not bind the baby to its data store: the
/// record is control plane, so withdrawing works even while a family's own database is down.
/// </summary>
internal static class CommunityConsentEndpoints
{
    public const string Path = "/community-consent";

    /// <summary>Maps <c>GET</c> and <c>PUT /community-consent</c>.</summary>
    public static IEndpointRouteBuilder MapCommunityConsentEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        var consent = api.MapGroup(BabyRoutes.Prefix)
            .RequireAuthorization(BabyPolicies.Write)
            .WithMetadata(CommunityInsightsEndpointMetadata.Instance);
        consent.MapGet(Path, GetAsync)
            .WithName("GetCommunityConsent")
            .ProducesProblem(StatusCodes.Status403Forbidden);
        consent.MapPut(Path, SetAsync)
            .WithName("SetCommunityConsent")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict);
        return api;
    }

    private static async Task<Ok<CommunityConsentResponse>> GetAsync(Guid babyId, ICommunityConsentService consents, CancellationToken cancellationToken) =>
        TypedResults.Ok(await consents.GetAsync(babyId, cancellationToken));

    private static async Task<Ok<CommunityConsentResponse>> SetAsync(Guid babyId, SetCommunityConsentRequest request, ICommunityConsentService consents, CancellationToken cancellationToken) =>
        TypedResults.Ok(await consents.SetAsync(babyId, request, cancellationToken));
}
