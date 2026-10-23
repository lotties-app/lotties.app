using Lotties.Application.Professionals;
using Lotties.Application.Users;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

internal static class MeEndpoints
{
    private const string ProfessionalProfilePath = "/me/professional-profile";

    /// <summary>
    /// Maps <c>GET /me</c> (the signed-in user, created on first sign-in) and the caller's own professional profile:
    /// <c>GET /me/professional-profile</c> (404 <c>professional_profile_not_found</c> before she declares one) and
    /// <c>PUT /me/professional-profile</c> (201 declared / 200 updated; any signed-in user, self-declared).
    /// </summary>
    public static IEndpointRouteBuilder MapMeEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        api.MapGet("/me", GetCurrentUserAsync)
            .WithName("GetCurrentUser")
            .Produces(StatusCodes.Status401Unauthorized);
        api.MapGet(ProfessionalProfilePath, GetProfessionalProfileAsync)
            .WithName("GetProfessionalProfile")
            .ProducesProblem(StatusCodes.Status404NotFound);
        api.MapPut(ProfessionalProfilePath, SaveProfessionalProfileAsync)
            .WithName("SaveProfessionalProfile")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        api.MapGet("/me/deletion-preview", PreviewDeletionAsync)
            .WithName("PreviewAccountDeletion");
        api.MapDelete("/me", DeleteAccountAsync)
            .WithName("DeleteAccount")
            .ProducesProblem(StatusCodes.Status409Conflict);
        return api;
    }

    private static async Task<Ok<AccountDeletionPreviewResponse>> PreviewDeletionAsync(IAccountDeletionService deletion, CancellationToken cancellationToken) =>
        TypedResults.Ok(await deletion.PreviewAsync(cancellationToken));

    private static async Task<Ok<AccountDeletionResponse>> DeleteAccountAsync(IAccountDeletionService deletion, CancellationToken cancellationToken) =>
        TypedResults.Ok(await deletion.DeleteAsync(cancellationToken));

    private static async Task<Ok<CurrentUserResponse>> GetCurrentUserAsync(ICurrentUser currentUser, CancellationToken cancellationToken) =>
        TypedResults.Ok<CurrentUserResponse>(await currentUser.GetUserAsync(cancellationToken));

    private static async Task<Ok<ProfessionalProfileResponse>> GetProfessionalProfileAsync(IProfessionalProfileService profiles, CancellationToken cancellationToken) =>
        TypedResults.Ok(await profiles.GetMineAsync(cancellationToken));

    private static async Task<Results<Created<ProfessionalProfileResponse>, Ok<ProfessionalProfileResponse>>> SaveProfessionalProfileAsync(
        SaveProfessionalProfileRequest request,
        IProfessionalProfileService profiles,
        CancellationToken cancellationToken)
    {
        var result = await profiles.SaveMineAsync(request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}{ProfessionalProfilePath}", result.Profile)
            : TypedResults.Ok(result.Profile);
    }
}
