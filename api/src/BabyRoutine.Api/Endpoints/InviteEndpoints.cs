using BabyRoutine.Api.Authorization;
using BabyRoutine.Application.Babies;
using Microsoft.AspNetCore.Http.HttpResults;

namespace BabyRoutine.Api.Endpoints;

/// <summary>
/// Invites. Managing a baby's invites needs <see cref="BabyPolicies.ManageMembers"/> (owner); accepting needs only a
/// signed-in user, because the token is the credential. Tokens are random, shown once and stored hashed.
/// </summary>
internal static class InviteEndpoints
{
    private const string InvitesPath = "/invites";
    private const string InvitePath = InvitesPath + "/{inviteId:guid}";

    /// <summary>
    /// Maps, under the baby-scoped group (owner only): <c>POST /invites</c> (201, the only response carrying the token),
    /// <c>GET /invites</c> (pending, no tokens) and <c>DELETE /invites/{inviteId}</c> (204, idempotent).
    /// </summary>
    public static RouteGroupBuilder MapInviteEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapPost(InvitesPath, CreateAsync)
            .RequireAuthorization(BabyPolicies.ManageMembers)
            .WithName("CreateInvite")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        baby.MapGet(InvitesPath, ListPendingAsync)
            .RequireAuthorization(BabyPolicies.ManageMembers)
            .WithName("ListPendingInvites");
        baby.MapDelete(InvitePath, RevokeAsync)
            .RequireAuthorization(BabyPolicies.ManageMembers)
            .WithName("RevokeInvite");
        return baby;
    }

    /// <summary>
    /// Maps <c>POST /invites/{token}/accept</c> under the API group: the signed-in user joins the invite's baby (200 with
    /// the baby). 404 unknown token, 410 expired, 409 already used or already a member.
    /// </summary>
    public static IEndpointRouteBuilder MapInviteAcceptEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        api.MapPost(InvitesPath + "/{token}/accept", AcceptAsync)
            .WithName("AcceptInvite")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status410Gone);
        return api;
    }

    private static async Task<Created<CreatedInviteResponse>> CreateAsync(
        Guid babyId,
        CreateInviteRequest request,
        IInviteService invites,
        CancellationToken cancellationToken)
    {
        var created = await invites.CreateAsync(babyId, request, cancellationToken);
        return TypedResults.Created($"{ApiEndpoints.V1Prefix}/babies/{babyId}{InvitesPath}", created);
    }

    private static async Task<Ok<IReadOnlyList<InviteResponse>>> ListPendingAsync(Guid babyId, IInviteService invites, CancellationToken cancellationToken) =>
        TypedResults.Ok(await invites.ListPendingAsync(babyId, cancellationToken));

    private static async Task<NoContent> RevokeAsync(Guid babyId, Guid inviteId, IInviteService invites, CancellationToken cancellationToken)
    {
        await invites.RevokeAsync(babyId, inviteId, cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<Ok<BabyResponse>> AcceptAsync(string token, IInviteService invites, CancellationToken cancellationToken) =>
        TypedResults.Ok(await invites.AcceptAsync(token, cancellationToken));
}
