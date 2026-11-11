using Lotties.Api.Consents;
using Lotties.Api.Limits;
using Lotties.Application.SilentPush;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The caller's app installs that want silent pushes for their widgets (docs/design/37b-widget-silent-push.md section
/// 4.1). Signed-in user only; 409 <c>silent_push_not_configured</c> while silent pushes (or the device's channel) are off.
/// Registering needs a current core consent and is blocked for a demo account; switching a device off is always allowed.
/// <c>GET /push/silent/status</c> is what the app reads before it asks the phone for a push token (section 5.4): only a
/// boolean, gated by consent like registering, and blocked for a demo account (which can never register).
/// </summary>
internal static class SilentPushEndpoints
{
    private const string DevicesPath = "/push/devices";
    private const string StatusPath = "/push/silent/status";

    /// <summary>
    /// Maps <c>GET /push/silent/status?channel=apns|fcm</c> (200 <c>{enabled}</c>, also while off), <c>POST /push/devices</c>
    /// (201 new / 200 refreshed) and <c>DELETE /push/devices/{deviceId}</c> (204, idempotent).
    /// </summary>
    public static IEndpointRouteBuilder MapSilentPushEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        api.MapGet(StatusPath, GetStatus)
            .WithName("GetSilentPushStatus")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        api.MapPost(DevicesPath, RegisterAsync)
            .RequireRateLimiting(RequestLimitPolicies.PushWrite)
            .WithName("RegisterSilentPushDevice")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        api.MapDelete(DevicesPath + "/{deviceId:guid}", UnregisterAsync)
            .AllowWithoutConsent("Switching a device off: a person can always stop pushes to her phone.")
            .RequireRateLimiting(RequestLimitPolicies.PushWrite)
            .WithName("UnregisterSilentPushDevice")
            .ProducesProblem(StatusCodes.Status409Conflict);
        return api;
    }

    private static Ok<SilentPushStatusResponse> GetStatus(string? channel, ISilentPushDeviceService devices) =>
        TypedResults.Ok(devices.Status(channel));

    private static async Task<Results<Created<SilentPushDeviceResponse>, Ok<SilentPushDeviceResponse>>> RegisterAsync(
        RegisterSilentPushDeviceRequest request,
        ISilentPushDeviceService devices,
        CancellationToken cancellationToken)
    {
        var result = await devices.RegisterAsync(request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}{DevicesPath}/{result.Device.Id}", result.Device)
            : TypedResults.Ok(result.Device);
    }

    private static async Task<NoContent> UnregisterAsync(Guid deviceId, ISilentPushDeviceService devices, CancellationToken cancellationToken)
    {
        await devices.UnregisterAsync(deviceId, cancellationToken);
        return TypedResults.NoContent();
    }
}
