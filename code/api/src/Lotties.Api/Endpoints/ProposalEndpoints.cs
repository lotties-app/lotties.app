using Lotties.Api.Authorization;
using Lotties.Application.Proposals;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// Prescription proposals of one baby (docs/design/16-doctor-access.md section 10.1; offline sync: idempotent upsert by
/// client GUID, delta pull). Reads need <see cref="BabyPolicies.Read"/> (from the baby group) and return only what the
/// caller sees (Owner and Parent: all; the Doctor: her own; Caregiver and Viewer: none, 404 by id); the Doctor writes
/// and withdraws her own (<see cref="BabyPolicies.Propose"/>); Owners and Parents accept or decline
/// (<see cref="BabyPolicies.Write"/>).
/// </summary>
internal static class ProposalEndpoints
{
    private const string ProposalsPath = "/prescription-proposals";
    private const string ProposalPath = ProposalsPath + "/{proposalId:guid}";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /prescription-proposals?since=</c>, <c>GET /prescription-proposals/{id}</c>,
    /// <c>PUT /prescription-proposals/{id}</c> (201 created / 200), <c>DELETE /prescription-proposals/{id}</c> (withdraw,
    /// 204, idempotent), <c>POST /prescription-proposals/{id}/accept</c> and <c>/decline</c> (200 <c>{proposal, prescription}</c>).
    /// </summary>
    public static RouteGroupBuilder MapProposalEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(ProposalsPath, ListChangesAsync).WithName("ListProposalChanges");
        baby.MapGet(ProposalPath, GetAsync).WithName("GetProposal").ProducesProblem(StatusCodes.Status404NotFound);
        baby.MapPut(ProposalPath, UpsertAsync)
            .RequireAuthorization(BabyPolicies.Propose)
            .WithName("UpsertProposal")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        baby.MapDelete(ProposalPath, WithdrawAsync)
            .RequireAuthorization(BabyPolicies.Propose)
            .WithName("WithdrawProposal");
        baby.MapPost(ProposalPath + "/accept", AcceptAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("AcceptProposal")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        baby.MapPost(ProposalPath + "/decline", DeclineAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("DeclineProposal")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        return baby;
    }

    private static async Task<Ok<IReadOnlyList<ProposalResponse>>> ListChangesAsync(Guid babyId, DateTimeOffset? since, IPrescriptionProposalService proposals, CancellationToken cancellationToken) =>
        TypedResults.Ok(await proposals.ListChangesAsync(babyId, since, cancellationToken));

    private static async Task<Ok<ProposalResponse>> GetAsync(Guid babyId, Guid proposalId, IPrescriptionProposalService proposals, CancellationToken cancellationToken) =>
        TypedResults.Ok(await proposals.GetAsync(babyId, proposalId, cancellationToken));

    private static async Task<Results<Created<ProposalResponse>, Ok<ProposalResponse>>> UpsertAsync(
        Guid babyId,
        Guid proposalId,
        UpsertProposalRequest request,
        IPrescriptionProposalService proposals,
        CancellationToken cancellationToken)
    {
        var result = await proposals.UpsertAsync(babyId, proposalId, request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}/babies/{babyId}{ProposalsPath}/{proposalId}", result.Proposal)
            : TypedResults.Ok(result.Proposal);
    }

    private static async Task<NoContent> WithdrawAsync(Guid babyId, Guid proposalId, IPrescriptionProposalService proposals, CancellationToken cancellationToken)
    {
        await proposals.WithdrawAsync(babyId, proposalId, cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<Ok<ProposalDecisionResponse>> AcceptAsync(
        Guid babyId,
        Guid proposalId,
        AcceptProposalRequest request,
        IPrescriptionProposalService proposals,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await proposals.AcceptAsync(babyId, proposalId, request, cancellationToken));

    private static async Task<Ok<ProposalDecisionResponse>> DeclineAsync(
        Guid babyId,
        Guid proposalId,
        DeclineProposalRequest request,
        IPrescriptionProposalService proposals,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await proposals.DeclineAsync(babyId, proposalId, request, cancellationToken));
}
