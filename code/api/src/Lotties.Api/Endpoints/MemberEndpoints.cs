using Lotties.Api.Authorization;
using Lotties.Application.Babies;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// Members of one baby. Any family member may list them (<see cref="BabyPolicies.ReadFamily"/>: a Doctor gets 403, the
/// family's names and roles are not clinical data) and any member may leave; changing roles and a Doctor's sections
/// (<c>doctorScopes</c>) and removing others needs
/// <see cref="BabyPolicies.ManageMembers"/>. The last owner can neither be demoted nor removed (409).
/// </summary>
internal static class MemberEndpoints
{
    private const string MembersPath = "/members";
    private const string MemberPath = MembersPath + "/{userId:guid}";
    private const string MePath = MembersPath + "/me";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /members</c>, <c>PATCH /members/{userId}</c> (body <c>{ role?, doctorScopes? }</c>),
    /// <c>DELETE /members/{userId}</c> and <c>DELETE /members/me</c> (leave).
    /// </summary>
    public static RouteGroupBuilder MapMemberEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(MembersPath, ListAsync)
            .RequireAuthorization(BabyPolicies.ReadFamily)
            .WithName("ListMembers");
        baby.MapPatch(MemberPath, ChangeAsync)
            .RequireAuthorization(BabyPolicies.ManageMembers)
            .WithName("ChangeMemberRole")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        baby.MapDelete(MemberPath, RemoveAsync)
            .RequireAuthorization(BabyPolicies.ManageMembers)
            .WithName("RemoveMember")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        baby.MapDelete(MePath, LeaveAsync)
            .WithName("LeaveBaby")
            .ProducesProblem(StatusCodes.Status409Conflict);
        return baby;
    }

    private static async Task<Ok<IReadOnlyList<MemberResponse>>> ListAsync(Guid babyId, IMemberService members, CancellationToken cancellationToken) =>
        TypedResults.Ok(await members.ListAsync(babyId, cancellationToken));

    private static async Task<Ok<MemberResponse>> ChangeAsync(
        Guid babyId,
        Guid userId,
        ChangeMemberRequest request,
        IMemberService members,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await members.ChangeAsync(babyId, userId, request, cancellationToken));

    private static async Task<NoContent> RemoveAsync(Guid babyId, Guid userId, IMemberService members, CancellationToken cancellationToken)
    {
        await members.RemoveAsync(babyId, userId, cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<NoContent> LeaveAsync(Guid babyId, IMemberService members, CancellationToken cancellationToken)
    {
        await members.LeaveAsync(babyId, cancellationToken);
        return TypedResults.NoContent();
    }
}
