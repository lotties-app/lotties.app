using Lotties.Api.Authorization;
using Lotties.Application.Formulas;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The formulas of one baby (offline sync: idempotent upsert by client GUID, delta pull). Reads need
/// <see cref="BabyPolicies.Read"/> (from the baby group, so a Caregiver can pick one when logging a bottle); writes,
/// archiving included, need <see cref="BabyPolicies.Write"/>. There is no delete: a formula is archived.
/// </summary>
internal static class FormulaEndpoints
{
    private const string FormulasPath = "/formulas";
    private const string FormulaPath = FormulasPath + "/{formulaId:guid}";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /formulas?since=</c> (archived included) and <c>PUT
    /// /formulas/{formulaId}</c> (201 created / 200 otherwise).
    /// </summary>
    public static RouteGroupBuilder MapFormulaEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(FormulasPath, ListChangesAsync).WithName("ListFormulaChanges");
        baby.MapPut(FormulaPath, UpsertAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("UpsertFormula")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        return baby;
    }

    private static async Task<Ok<IReadOnlyList<FormulaResponse>>> ListChangesAsync(
        Guid babyId,
        DateTimeOffset? since,
        IFormulaService formulas,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await formulas.ListChangesAsync(babyId, since, cancellationToken));

    private static async Task<Results<Created<FormulaResponse>, Ok<FormulaResponse>>> UpsertAsync(
        Guid babyId,
        Guid formulaId,
        UpsertFormulaRequest request,
        IFormulaService formulas,
        CancellationToken cancellationToken)
    {
        var result = await formulas.UpsertAsync(babyId, formulaId, request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}/babies/{babyId}{FormulasPath}/{formulaId}", result.Formula)
            : TypedResults.Ok(result.Formula);
    }
}
