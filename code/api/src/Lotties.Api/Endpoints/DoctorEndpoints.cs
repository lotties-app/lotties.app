using Lotties.Application.Clinical;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The signed-in doctor's dashboard. Needs only a signed-in user: it lists the babies where her role is Doctor (none for a
/// parent), each with the figures her scopes on that baby open.
/// </summary>
internal static class DoctorEndpoints
{
    private const string PatientsPath = "/doctor/patients";

    /// <summary>
    /// Maps, under the API group: <c>GET /doctor/patients?timeZone=&amp;utcOffsetMinutes=</c> (by baby name then id; a view is
    /// recorded in each baby's access log, at most hourly).
    /// </summary>
    public static IEndpointRouteBuilder MapDoctorEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        api.MapGet(PatientsPath, ListPatientsAsync)
            .WithName("ListDoctorPatients")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        return api;
    }

    private static async Task<Results<Ok<IReadOnlyList<DoctorPatientResponse>>, ValidationProblem>> ListPatientsAsync(
        string? timeZone,
        int? utcOffsetMinutes,
        IDoctorPatientsService patients,
        CancellationToken cancellationToken)
    {
        if (!UtcOffsetQuery.IsValid(utcOffsetMinutes))
        {
            return UtcOffsetQuery.Invalid();
        }

        var request = new DoctorPatientsRequest(timeZone, UtcOffsetQuery.ToOffset(utcOffsetMinutes));
        return TypedResults.Ok(await patients.ListAsync(request, cancellationToken));
    }
}
