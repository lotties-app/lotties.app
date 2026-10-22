using Lotties.Api.Authorization;
using Lotties.Application.Appointments;
using Lotties.Domain.Appointments;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The appointments of one baby (offline sync: idempotent upsert by client GUID, delta pull, calendar range). Reads need
/// <see cref="BabyPolicies.Read"/> (from the baby group: every member, Caregivers and Viewers read only); writes,
/// cancelling and marking done included, need <see cref="BabyPolicies.Write"/>. There is no delete: cancelling is the
/// soft delete.
/// </summary>
internal static class AppointmentEndpoints
{
    private const string AppointmentsPath = "/appointments";
    private const string AppointmentPath = AppointmentsPath + "/{appointmentId:guid}";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /appointments?since=&amp;from=&amp;to=</c> (cancelled and done
    /// included), <c>GET /appointments/{appointmentId}</c> and <c>PUT /appointments/{appointmentId}</c> (201 created /
    /// 200 otherwise).
    /// </summary>
    public static RouteGroupBuilder MapAppointmentEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(AppointmentsPath, ListAsync)
            .WithName("ListAppointments")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        baby.MapGet(AppointmentPath, GetAsync)
            .WithName("GetAppointment")
            .ProducesProblem(StatusCodes.Status404NotFound);
        baby.MapPut(AppointmentPath, UpsertAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("UpsertAppointment")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        return baby;
    }

    private static async Task<Ok<IReadOnlyList<AppointmentResponse>>> ListAsync(
        Guid babyId,
        DateTimeOffset? since,
        DateTimeOffset? from,
        DateTimeOffset? to,
        IAppointmentService appointments,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await appointments.ListAsync(babyId, new AppointmentQuery(since, from, to), cancellationToken));

    private static async Task<Ok<AppointmentResponse>> GetAsync(
        Guid babyId,
        Guid appointmentId,
        IAppointmentService appointments,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await appointments.GetAsync(babyId, appointmentId, cancellationToken));

    private static async Task<Results<Created<AppointmentResponse>, Ok<AppointmentResponse>>> UpsertAsync(
        Guid babyId,
        Guid appointmentId,
        UpsertAppointmentRequest request,
        IAppointmentService appointments,
        CancellationToken cancellationToken)
    {
        var result = await appointments.UpsertAsync(babyId, appointmentId, request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}/babies/{babyId}{AppointmentsPath}/{appointmentId}", result.Appointment)
            : TypedResults.Ok(result.Appointment);
    }
}
