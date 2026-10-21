using Lotties.Api.Authorization;
using Lotties.Api.Limits;
using Lotties.Application.Push;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// Push notifications (docs/SPEC.md "Push notifications"). User-level routes need a signed-in user only; the reminder
/// preferences of one baby need <see cref="BabyPolicies.Write"/> (Viewers never receive baby reminders); the snooze/dismiss
/// route is anonymous, authorized by the delivery's action token. When push is not configured every route except
/// <c>GET /push/config</c> is 409 <c>push_not_configured</c>.
/// </summary>
internal static class PushEndpoints
{
    private const string PushPath = "/push";
    private const string SubscriptionsPath = "/subscriptions";

    /// <summary>
    /// Maps <c>GET /push/config</c>, <c>POST /push/subscriptions</c> (201 new / 200 refreshed), <c>POST /push/subscriptions/revoke</c>
    /// (204), <c>GET /push/subscriptions</c>, <c>DELETE /push/subscriptions/{id}</c> (204), <c>GET</c>/<c>PUT /push/settings</c>,
    /// <c>GET /push/preferences</c>, <c>POST /push/test</c> and the anonymous <c>POST /push/deliveries/{deliveryId}/actions</c> (204).
    /// </summary>
    public static IEndpointRouteBuilder MapPushEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        var push = api.MapGroup(PushPath);
        push.MapGet("/config", GetConfig).WithName("GetPushConfig");
        push.MapPost(SubscriptionsPath, SubscribeAsync)
            .RequireRateLimiting(RequestLimitPolicies.PushWrite)
            .WithName("SubscribePush")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        push.MapPost(SubscriptionsPath + "/revoke", RevokeByEndpointAsync)
            .RequireRateLimiting(RequestLimitPolicies.PushWrite)
            .WithName("RevokePushSubscriptionByEndpoint")
            .ProducesProblem(StatusCodes.Status409Conflict);
        push.MapGet(SubscriptionsPath, ListSubscriptionsAsync)
            .WithName("ListPushSubscriptions")
            .ProducesProblem(StatusCodes.Status409Conflict);
        push.MapDelete(SubscriptionsPath + "/{subscriptionId:guid}", RevokeAsync)
            .RequireRateLimiting(RequestLimitPolicies.PushWrite)
            .WithName("RevokePushSubscription")
            .ProducesProblem(StatusCodes.Status409Conflict);
        push.MapGet("/settings", GetSettingsAsync)
            .WithName("GetNotificationSettings")
            .ProducesProblem(StatusCodes.Status409Conflict);
        push.MapPut("/settings", PutSettingsAsync)
            .RequireRateLimiting(RequestLimitPolicies.PushWrite)
            .WithName("PutNotificationSettings")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        push.MapGet("/preferences", ListPreferencesAsync)
            .WithName("ListNotificationPreferences")
            .ProducesProblem(StatusCodes.Status409Conflict);
        push.MapPost("/test", SendTestAsync)
            .RequireRateLimiting(RequestLimitPolicies.PushTest)
            .WithName("SendTestPush")
            .ProducesProblem(StatusCodes.Status409Conflict);
        push.MapPost("/deliveries/{deliveryId:guid}/actions", ApplyActionAsync)
            .AllowAnonymous()
            .RequireRateLimiting(RequestLimitPolicies.PushAction)
            .WithName("ApplyNotificationAction")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        return api;
    }

    /// <summary>Maps, under the baby-scoped group, <c>PUT /notification-preferences</c> (Parent/Owner; 200 with the stored state).</summary>
    public static RouteGroupBuilder MapNotificationPreferenceEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapPut("/notification-preferences", PutPreferencesAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .RequireRateLimiting(RequestLimitPolicies.PushWrite)
            .WithName("PutBabyNotificationPreferences")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        return baby;
    }

    private static Ok<PushConfigResponse> GetConfig(IPushSubscriptionService subscriptions) => TypedResults.Ok(subscriptions.GetConfig());

    private static async Task<Results<Created<PushSubscriptionResponse>, Ok<PushSubscriptionResponse>>> SubscribeAsync(
        SubscribePushRequest request,
        IPushSubscriptionService subscriptions,
        CancellationToken cancellationToken)
    {
        var result = await subscriptions.SubscribeAsync(request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}{PushPath}{SubscriptionsPath}", result.Subscription)
            : TypedResults.Ok(result.Subscription);
    }

    private static async Task<NoContent> RevokeByEndpointAsync(RevokePushSubscriptionRequest request, IPushSubscriptionService subscriptions, CancellationToken cancellationToken)
    {
        await subscriptions.RevokeByEndpointAsync(request, cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<Ok<IReadOnlyList<PushSubscriptionResponse>>> ListSubscriptionsAsync(IPushSubscriptionService subscriptions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await subscriptions.ListAsync(cancellationToken));

    private static async Task<NoContent> RevokeAsync(Guid subscriptionId, IPushSubscriptionService subscriptions, CancellationToken cancellationToken)
    {
        await subscriptions.RevokeAsync(subscriptionId, cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<Ok<NotificationSettingsDto>> GetSettingsAsync(INotificationPreferencesService preferences, CancellationToken cancellationToken) =>
        TypedResults.Ok(await preferences.GetSettingsAsync(cancellationToken));

    private static async Task<Ok<NotificationSettingsDto>> PutSettingsAsync(NotificationSettingsDto request, INotificationPreferencesService preferences, CancellationToken cancellationToken) =>
        TypedResults.Ok(await preferences.PutSettingsAsync(request, cancellationToken));

    private static async Task<Ok<IReadOnlyList<BabyNotificationPreferencesResponse>>> ListPreferencesAsync(INotificationPreferencesService preferences, CancellationToken cancellationToken) =>
        TypedResults.Ok(await preferences.ListPreferencesAsync(cancellationToken));

    private static async Task<Ok<BabyNotificationPreferencesResponse>> PutPreferencesAsync(
        Guid babyId,
        PutBabyNotificationPreferencesRequest request,
        INotificationPreferencesService preferences,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await preferences.PutPreferencesAsync(babyId, request, cancellationToken));

    private static async Task<Ok<PushTestResponse>> SendTestAsync(PushTestRequest request, IPushTestService tests, CancellationToken cancellationToken) =>
        TypedResults.Ok(await tests.SendAsync(request, cancellationToken));

    private static async Task<NoContent> ApplyActionAsync(Guid deliveryId, NotificationActionRequest request, INotificationActionService actions, CancellationToken cancellationToken)
    {
        await actions.ApplyAsync(deliveryId, request, cancellationToken);
        return TypedResults.NoContent();
    }
}
