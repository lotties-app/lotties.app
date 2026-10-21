using BabyRoutine.Application.Users;
using Microsoft.AspNetCore.Http.HttpResults;

namespace BabyRoutine.Api.Endpoints;

internal static class MeEndpoints
{
    /// <summary>Maps <c>GET /me</c>: the signed-in user, created on first sign-in.</summary>
    public static IEndpointRouteBuilder MapMeEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        api.MapGet("/me", GetCurrentUserAsync)
            .WithName("GetCurrentUser")
            .Produces(StatusCodes.Status401Unauthorized);
        return api;
    }

    private static async Task<Ok<CurrentUserResponse>> GetCurrentUserAsync(ICurrentUser currentUser, CancellationToken cancellationToken) =>
        TypedResults.Ok<CurrentUserResponse>(await currentUser.GetUserAsync(cancellationToken));
}
