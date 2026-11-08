using Lotties.Api.Assistants;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Consents;
using Lotties.Application.Assistants;
using Lotties.Application.Professionals;
using Lotties.Application.Rest;
using Lotties.Application.FeedingPreferences;
using Lotties.Application.Units;
using Lotties.Application.Users;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Endpoints;

internal static class MeEndpoints
{
    private const string ProfessionalProfilePath = "/me/professional-profile";
    private const string AssistantSettingsPath = "/me/assistant-settings";
    private const string UnitSettingsPath = "/me/unit-settings";
    private const string FeedingSettingsPath = "/me/feeding-settings";
    private const string RestSettingsPath = "/me/rest-settings";

    private const string MeReason = "The person's own account, profile and settings: no baby data, and she must always be able to see, export and delete what is hers (docs/design/38-consent-and-terms.md).";

    /// <summary>
    /// Maps <c>GET /me</c> (the signed-in user, created on first sign-in) and the caller's own professional profile:
    /// <c>GET /me/professional-profile</c> (404 <c>professional_profile_not_found</c> before she declares one) and
    /// <c>PUT /me/professional-profile</c> (201 declared / 200 updated; any signed-in user, self-declared), and the
    /// caller's voice assistant settings <c>GET</c>/<c>PUT /me/assistant-settings</c> (the default baby, plus whether the MCP
    /// server is on and its URL; docs/design/32-assistants.md), and her measurement unit setting <c>GET</c>/<c>PUT /me/unit-settings</c>
    /// (<c>{system: auto|metric|us}</c>, any signed-in user; docs/design/37-measurement-units.md).
    /// </summary>
    public static IEndpointRouteBuilder MapMeEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        api.MapGet("/me", GetCurrentUserAsync)
            .AllowWithoutConsent(MeReason)
            .WithName("GetCurrentUser")
            .Produces(StatusCodes.Status401Unauthorized);
        api.MapPut("/me/profile", SaveProfileAsync)
            .AllowWithoutConsent(MeReason)
            .WithName("SaveUserProfile")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        api.MapGet(ProfessionalProfilePath, GetProfessionalProfileAsync)
            .AllowWithoutConsent(MeReason)
            .WithName("GetProfessionalProfile")
            .ProducesProblem(StatusCodes.Status404NotFound);
        api.MapPut(ProfessionalProfilePath, SaveProfessionalProfileAsync)
            .AllowWithoutConsent(MeReason)
            .WithName("SaveProfessionalProfile")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        api.MapGet("/me/deletion-preview", PreviewDeletionAsync)
            .AllowWithoutConsent(MeReason)
            .WithName("PreviewAccountDeletion");
        api.MapDelete("/me", DeleteAccountAsync)
            .AllowWithoutConsent(MeReason)
            .WithName("DeleteAccount")
            .ProducesProblem(StatusCodes.Status409Conflict);
        api.MapGet(AssistantSettingsPath, GetAssistantSettingsAsync)
            .AllowWithoutConsent(MeReason)
            .WithName("GetAssistantSettings");
        api.MapPut(AssistantSettingsPath, SaveAssistantSettingsAsync)
            .AllowWithoutConsent(MeReason)
            .WithName("SaveAssistantSettings")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        api.MapGet(UnitSettingsPath, GetUnitSettingsAsync)
            .AllowWithoutConsent(MeReason)
            .WithName("GetUnitSettings");
        api.MapPut(UnitSettingsPath, SaveUnitSettingsAsync)
            .AllowWithoutConsent(MeReason)
            .WithName("SaveUnitSettings")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        api.MapGet(FeedingSettingsPath, GetFeedingSettingsAsync)
            .AllowWithoutConsent(MeReason)
            .WithName("GetFeedingSettings");
        api.MapPut(FeedingSettingsPath, SaveFeedingSettingsAsync)
            .AllowWithoutConsent(MeReason)
            .WithName("SaveFeedingSettings")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        api.MapGet(RestSettingsPath, GetRestSettingsAsync)
            .WithName("GetRestSettings");
        api.MapPut(RestSettingsPath, SaveRestSettingsAsync)
            .WithName("SaveRestSettings")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        api.MapDelete(RestSettingsPath, DeleteRestSettingsAsync)
            .WithName("DeleteRestSettings");
        api.MapGet("/me/rest", GetRestEstimateAsync)
            .WithName("GetRestEstimate")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        api.MapPut("/me/rest/morning", SaveRestMorningAsync)
            .WithName("SaveRestMorning")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        api.MapConsentEndpoints();
        return api;
    }

    private static async Task<Ok<AssistantSettingsView>> GetAssistantSettingsAsync(
        IAssistantSettingsService settings,
        HttpRequest httpRequest,
        IOptions<McpOptions> mcp,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(AssistantSettingsView.Of(await settings.GetMineAsync(cancellationToken), httpRequest, mcp.Value));

    private static async Task<Ok<AssistantSettingsView>> SaveAssistantSettingsAsync(
        SaveAssistantSettingsRequest request,
        IAssistantSettingsService settings,
        HttpRequest httpRequest,
        IOptions<McpOptions> mcp,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(AssistantSettingsView.Of(await settings.SaveMineAsync(request, cancellationToken), httpRequest, mcp.Value));

    private static async Task<Ok<UnitSettingsResponse>> GetUnitSettingsAsync(IUnitSettingsService settings, CancellationToken cancellationToken) =>
        TypedResults.Ok(await settings.GetMineAsync(cancellationToken));

    private static async Task<Ok<UnitSettingsResponse>> SaveUnitSettingsAsync(SaveUnitSettingsRequest request, IUnitSettingsService settings, CancellationToken cancellationToken) =>
        TypedResults.Ok(await settings.SaveMineAsync(request, cancellationToken));

    private static async Task<Ok<FeedingSettingsResponse>> GetFeedingSettingsAsync(IFeedingSettingsService settings, CancellationToken cancellationToken) =>
        TypedResults.Ok(await settings.GetMineAsync(cancellationToken));

    private static async Task<Ok<FeedingSettingsResponse>> SaveFeedingSettingsAsync(SaveFeedingSettingsRequest request, IFeedingSettingsService settings, CancellationToken cancellationToken) =>
        TypedResults.Ok(await settings.SaveMineAsync(request, cancellationToken));

    private static async Task<Ok<RestSettingsResponse>> GetRestSettingsAsync(IRestSettingsService rest, CancellationToken cancellationToken) =>
        TypedResults.Ok(await rest.GetMineAsync(cancellationToken));

    private static async Task<Ok<RestSettingsResponse>> SaveRestSettingsAsync(SaveRestSettingsRequest request, IRestSettingsService rest, CancellationToken cancellationToken) =>
        TypedResults.Ok(await rest.SaveMineAsync(request, cancellationToken));

    private static async Task<NoContent> DeleteRestSettingsAsync(IRestSettingsService rest, CancellationToken cancellationToken)
    {
        await rest.DeleteMineAsync(cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<Ok<RestEstimateResponse>> GetRestEstimateAsync(string? night, IRestEstimateService estimate, CancellationToken cancellationToken) =>
        TypedResults.Ok(await estimate.GetMineAsync(night, cancellationToken));

    private static async Task<NoContent> SaveRestMorningAsync(SaveRestMorningRequest request, IRestSettingsService rest, CancellationToken cancellationToken)
    {
        await rest.SaveMorningAsync(request, cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<Ok<AccountDeletionPreviewResponse>> PreviewDeletionAsync(IAccountDeletionService deletion, CancellationToken cancellationToken) =>
        TypedResults.Ok(await deletion.PreviewAsync(cancellationToken));

    /// <summary><c>?wipeOwnDatabase=true</c> (opt-in, default false) also deletes the erased babies' records in her own database (design 47 section 9).</summary>
    private static async Task<Ok<AccountDeletionResponse>> DeleteAccountAsync(
        IAccountDeletionService deletion,
        CancellationToken cancellationToken,
        [FromQuery] bool wipeOwnDatabase = false) =>
        TypedResults.Ok(await deletion.DeleteAsync(new AccountDeletionRequest { WipeOwnDatabase = wipeOwnDatabase }, cancellationToken));

    private static async Task<Ok<CurrentUserResponse>> GetCurrentUserAsync(ICurrentUser currentUser, CancellationToken cancellationToken) =>
        TypedResults.Ok<CurrentUserResponse>(await currentUser.GetUserAsync(cancellationToken));

    private static async Task<Ok<CurrentUserResponse>> SaveProfileAsync(SaveUserProfileRequest request, IUserProfileService profiles, CancellationToken cancellationToken) =>
        TypedResults.Ok(await profiles.SaveMineAsync(request, cancellationToken));

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
