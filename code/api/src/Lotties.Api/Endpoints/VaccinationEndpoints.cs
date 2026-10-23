using Lotties.Api.Authorization;
using Lotties.Application.Vaccinations;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Net.Http.Headers;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The vaccine schedule (any signed-in user) and the recorded vaccines of one baby (offline sync: idempotent upsert by
/// client GUID, delta pull, soft delete; docs/design/18-vaccines.md). Reads of a baby's records need
/// <see cref="BabyPolicies.Read"/> (every member: Caregivers, Viewers and Doctors read only; a Doctor needs the vaccines
/// scope, <see cref="BabyPolicies.ScopeVaccines"/>); recording, editing and
/// deleting need <see cref="BabyPolicies.Write"/> (Owner, Parent).
/// </summary>
internal static class VaccinationEndpoints
{
    public const string SchedulePath = "/vaccine-schedule";
    private const string VaccinationsPath = "/vaccinations";
    private const string VaccinationPath = VaccinationsPath + "/{vaccinationId:guid}";

    /// <summary>The schedule may be cached privately for an hour; after that a client revalidates with <c>If-None-Match</c>.</summary>
    private const string ScheduleCacheControl = "private, max-age=3600";

    /// <summary>
    /// Maps <c>GET /vaccine-schedule</c>: the schedule file as shipped, with a strong <c>ETag</c> (304 on a matching
    /// <c>If-None-Match</c>) and <c>Cache-Control: private, max-age=3600</c>. Resolving the schedule here validates it at
    /// startup: an invalid file stops the API.
    /// </summary>
    public static IEndpointRouteBuilder MapVaccineScheduleEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _ = api.ServiceProvider.GetRequiredService<IVaccineScheduleProvider>();
        api.MapGet(SchedulePath, GetSchedule)
            .WithName("GetVaccineSchedule")
            .Produces(StatusCodes.Status200OK, contentType: "application/json")
            .Produces(StatusCodes.Status304NotModified);
        return api;
    }

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /vaccinations?since=</c> (deleted included), <c>PUT /vaccinations/{id}</c>
    /// (201 created / 200 otherwise) and <c>DELETE /vaccinations/{id}</c> (204, soft and idempotent).
    /// </summary>
    public static RouteGroupBuilder MapVaccinationEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(VaccinationsPath, ListAsync)
            .RequireAuthorization(BabyPolicies.ScopeVaccines)
            .WithName("ListVaccinations");
        baby.MapPut(VaccinationPath, UpsertAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("UpsertVaccination")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        baby.MapDelete(VaccinationPath, DeleteAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("DeleteVaccination");
        return baby;
    }

    private static IResult GetSchedule(HttpContext http, IVaccineScheduleProvider schedule)
    {
        http.Response.Headers.ETag = schedule.ETag;
        http.Response.Headers.CacheControl = ScheduleCacheControl;
        var requested = http.Request.GetTypedHeaders().IfNoneMatch;
        var current = new EntityTagHeaderValue(schedule.ETag);
        return requested.Any(tag => tag.Compare(current, useStrongComparison: false) || tag.Equals(EntityTagHeaderValue.Any))
            ? Results.StatusCode(StatusCodes.Status304NotModified)
            : Results.Bytes(schedule.Json, "application/json");
    }

    private static async Task<Ok<IReadOnlyList<VaccinationResponse>>> ListAsync(
        Guid babyId,
        DateTimeOffset? since,
        IVaccinationService vaccinations,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await vaccinations.ListAsync(babyId, since, cancellationToken));

    private static async Task<Results<Created<VaccinationResponse>, Ok<VaccinationResponse>>> UpsertAsync(
        Guid babyId,
        Guid vaccinationId,
        UpsertVaccinationRequest request,
        IVaccinationService vaccinations,
        CancellationToken cancellationToken)
    {
        var result = await vaccinations.UpsertAsync(babyId, vaccinationId, request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}/babies/{babyId}{VaccinationsPath}/{vaccinationId}", result.Vaccination)
            : TypedResults.Ok(result.Vaccination);
    }

    private static async Task<NoContent> DeleteAsync(Guid babyId, Guid vaccinationId, IVaccinationService vaccinations, CancellationToken cancellationToken)
    {
        await vaccinations.DeleteAsync(babyId, vaccinationId, cancellationToken);
        return TypedResults.NoContent();
    }
}
