using Lotties.Api.Authorization;
using Lotties.Application.AccessLogs;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The baby's access log (docs/design/16-doctor-access.md): <see cref="RecordDoctorAccess"/> writes it when a Doctor
/// loads the baby's data; the Owner reads it (<see cref="BabyPolicies.ManageMembers"/>).
/// </summary>
internal static class AccessLogEndpoints
{
    private const string AccessLogPath = "/access-log";

    /// <summary>Maps, under the baby-scoped group: <c>GET /access-log</c> (Owner; the newest 50 entries, newest first).</summary>
    public static RouteGroupBuilder MapAccessLogEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(AccessLogPath, ListAsync)
            .RequireAuthorization(BabyPolicies.ManageMembers)
            .WithName("ListAccessLog");
        return baby;
    }

    /// <summary>
    /// Endpoint filter of the baby-scoped group: before every <c>GET</c> a member is authorized for, records the access
    /// when she is a Doctor (at most once per hour per doctor and baby, <see cref="IAccessLogService.RecordViewAsync"/>).
    /// </summary>
    public static async ValueTask<object?> RecordDoctorAccess(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);
        var http = context.HttpContext;
        if (HttpMethods.IsGet(http.Request.Method) && Guid.TryParse(http.GetRouteValue(BabyRoutes.BabyIdParameter)?.ToString(), out var babyId))
        {
            await http.RequestServices.GetRequiredService<IAccessLogService>().RecordViewAsync(babyId, http.RequestAborted);
        }

        return await next(context);
    }

    private static async Task<Ok<IReadOnlyList<AccessLogEntryResponse>>> ListAsync(Guid babyId, IAccessLogService accessLog, CancellationToken cancellationToken) =>
        TypedResults.Ok(await accessLog.ListAsync(babyId, cancellationToken));
}
