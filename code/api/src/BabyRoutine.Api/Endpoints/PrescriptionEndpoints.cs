using BabyRoutine.Api.Authorization;
using BabyRoutine.Application.Prescriptions;
using Microsoft.AspNetCore.Http.HttpResults;

namespace BabyRoutine.Api.Endpoints;

/// <summary>
/// Prescriptions of one baby (offline sync: idempotent upsert by client GUID, soft delete, delta pull) and the computed
/// medication status. Reads need <see cref="BabyPolicies.Read"/> (from the baby group), writes <see cref="BabyPolicies.Write"/>.
/// </summary>
internal static class PrescriptionEndpoints
{
    private const string PrescriptionsPath = "/prescriptions";
    private const string PrescriptionPath = PrescriptionsPath + "/{prescriptionId:guid}";
    private const string StatusPath = "/medications/status";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /prescriptions?since=</c> (soft-deleted included), <c>PUT
    /// /prescriptions/{prescriptionId}</c> (201 created / 200 otherwise), <c>DELETE /prescriptions/{prescriptionId}</c>
    /// (204, idempotent) and <c>GET /medications/status?utcOffsetMinutes=</c>.
    /// </summary>
    public static RouteGroupBuilder MapPrescriptionEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(PrescriptionsPath, ListChangesAsync).WithName("ListPrescriptionChanges");
        baby.MapPut(PrescriptionPath, UpsertAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("UpsertPrescription")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        baby.MapDelete(PrescriptionPath, DeleteAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("DeletePrescription");
        baby.MapGet(StatusPath, GetStatusAsync)
            .WithName("GetMedicationStatus")
            .ProducesValidationProblem();
        return baby;
    }

    private static async Task<Ok<IReadOnlyList<PrescriptionResponse>>> ListChangesAsync(
        Guid babyId,
        DateTimeOffset? since,
        IPrescriptionService prescriptions,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await prescriptions.ListChangesAsync(babyId, since, cancellationToken));

    private static async Task<Results<Created<PrescriptionResponse>, Ok<PrescriptionResponse>>> UpsertAsync(
        Guid babyId,
        Guid prescriptionId,
        UpsertPrescriptionRequest request,
        IPrescriptionService prescriptions,
        CancellationToken cancellationToken)
    {
        var result = await prescriptions.UpsertAsync(babyId, prescriptionId, request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}/babies/{babyId}{PrescriptionsPath}/{prescriptionId}", result.Prescription)
            : TypedResults.Ok(result.Prescription);
    }

    private static async Task<NoContent> DeleteAsync(Guid babyId, Guid prescriptionId, IPrescriptionService prescriptions, CancellationToken cancellationToken)
    {
        await prescriptions.DeleteAsync(babyId, prescriptionId, cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<MedicationStatusListResponse>, ValidationProblem>> GetStatusAsync(
        Guid babyId,
        int? utcOffsetMinutes,
        IMedicationStatusService status,
        TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        if (utcOffsetMinutes is < -PredictionEndpoints.MaxUtcOffsetMinutes or > PredictionEndpoints.MaxUtcOffsetMinutes)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                [PredictionEndpoints.UtcOffsetMinutesParameter] = [$"Must be between -{PredictionEndpoints.MaxUtcOffsetMinutes} and {PredictionEndpoints.MaxUtcOffsetMinutes}."],
            });
        }

        var offset = TimeSpan.FromMinutes(utcOffsetMinutes ?? 0);
        return TypedResults.Ok(await status.GetAsync(babyId, timeProvider.GetUtcNow(), offset, cancellationToken));
    }
}
