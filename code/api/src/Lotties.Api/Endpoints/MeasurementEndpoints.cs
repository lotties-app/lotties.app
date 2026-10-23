using Lotties.Api.Authorization;
using Lotties.Application.Measurements;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// Growth measurements of one baby. Everything needs, for a Doctor, the growth scope (<see cref="BabyPolicies.ScopeGrowth"/>).
/// Reads need <see cref="BabyPolicies.Read"/> (from the baby group), writes
/// <see cref="BabyPolicies.Measure"/> (Owner, Parent, and a Doctor for her consultation measurements, who changes only
/// her own). Deletion is a hard delete.
/// </summary>
internal static class MeasurementEndpoints
{
    private const string MeasurementsPath = "/measurements";
    private const string MeasurementPath = MeasurementsPath + "/{measurementId:guid}";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /measurements</c> (date descending), <c>PUT /measurements/{measurementId}</c>
    /// (idempotent upsert by client GUID, 201 created / 200 otherwise) and <c>DELETE /measurements/{measurementId}</c> (204, idempotent).
    /// </summary>
    public static RouteGroupBuilder MapMeasurementEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(MeasurementsPath, ListAsync)
            .RequireAuthorization(BabyPolicies.ScopeGrowth)
            .WithName("ListMeasurements");
        baby.MapPut(MeasurementPath, UpsertAsync)
            .RequireAuthorization(BabyPolicies.Measure, BabyPolicies.ScopeGrowth)
            .WithName("UpsertMeasurement")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        baby.MapDelete(MeasurementPath, DeleteAsync)
            .RequireAuthorization(BabyPolicies.Measure, BabyPolicies.ScopeGrowth)
            .WithName("DeleteMeasurement")
            .ProducesProblem(StatusCodes.Status403Forbidden);
        return baby;
    }

    private static async Task<Ok<IReadOnlyList<MeasurementResponse>>> ListAsync(Guid babyId, IMeasurementService measurements, CancellationToken cancellationToken) =>
        TypedResults.Ok(await measurements.ListAsync(babyId, cancellationToken));

    private static async Task<Results<Created<MeasurementResponse>, Ok<MeasurementResponse>>> UpsertAsync(
        Guid babyId,
        Guid measurementId,
        UpsertMeasurementRequest request,
        IMeasurementService measurements,
        CancellationToken cancellationToken)
    {
        var result = await measurements.UpsertAsync(babyId, measurementId, request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}/babies/{babyId}{MeasurementsPath}/{measurementId}", result.Measurement)
            : TypedResults.Ok(result.Measurement);
    }

    private static async Task<NoContent> DeleteAsync(Guid babyId, Guid measurementId, IMeasurementService measurements, CancellationToken cancellationToken)
    {
        await measurements.DeleteAsync(babyId, measurementId, cancellationToken);
        return TypedResults.NoContent();
    }
}
