using Lotties.Api.Authorization;
using Lotties.Application.Medications;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// Medication catalog of one baby. Reads need <see cref="BabyPolicies.Read"/> (from the baby group) and, for a Doctor,
/// the medications scope (<see cref="BabyPolicies.ScopeMedications"/>), writes
/// <see cref="BabyPolicies.Write"/>. Deletion is a hard delete; events keep their own copy of the medication name.
/// </summary>
internal static class MedicationEndpoints
{
    private const string MedicationsPath = "/medications";
    private const string MedicationPath = MedicationsPath + "/{medicationId:guid}";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /medications</c>, <c>PUT /medications/{medicationId}</c> (idempotent
    /// upsert by client GUID, 201 created / 200 otherwise) and <c>DELETE /medications/{medicationId}</c> (204, idempotent).
    /// </summary>
    public static RouteGroupBuilder MapMedicationEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(MedicationsPath, ListAsync)
            .RequireAuthorization(BabyPolicies.ScopeMedications)
            .WithName("ListMedications");
        baby.MapPut(MedicationPath, UpsertAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("UpsertMedication")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        baby.MapDelete(MedicationPath, DeleteAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("DeleteMedication");
        return baby;
    }

    private static async Task<Ok<IReadOnlyList<MedicationResponse>>> ListAsync(Guid babyId, IMedicationService medications, CancellationToken cancellationToken) =>
        TypedResults.Ok(await medications.ListAsync(babyId, cancellationToken));

    private static async Task<Results<Created<MedicationResponse>, Ok<MedicationResponse>>> UpsertAsync(
        Guid babyId,
        Guid medicationId,
        UpsertMedicationRequest request,
        IMedicationService medications,
        CancellationToken cancellationToken)
    {
        var result = await medications.UpsertAsync(babyId, medicationId, request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}/babies/{babyId}{MedicationsPath}/{medicationId}", result.Medication)
            : TypedResults.Ok(result.Medication);
    }

    private static async Task<NoContent> DeleteAsync(Guid babyId, Guid medicationId, IMedicationService medications, CancellationToken cancellationToken)
    {
        await medications.DeleteAsync(babyId, medicationId, cancellationToken);
        return TypedResults.NoContent();
    }
}
