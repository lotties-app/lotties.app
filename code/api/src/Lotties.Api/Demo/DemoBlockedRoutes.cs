using Lotties.Application.Users;
using Lotties.Domain.Exceptions;

namespace Lotties.Api.Demo;

/// <summary>
/// The routes a try-it demo account cannot use (docs/design/45-try-it-demo.md section 2): invites and Doctor access, push, assistant
/// settings and optional consents, exports and imports, address lookup, a second baby, the shared catalog's writes and the baby's own
/// database (data-store routes: they send data to a host the user chooses). Keys are
/// <c>"METHOD /route/pattern"</c> as the endpoint data source lists them; <c>DemoBlockedRoutesTests</c> fails when a key matches no route.
/// </summary>
public static class DemoBlockedRoutes
{
    public static readonly IReadOnlySet<string> Keys = new HashSet<string>(StringComparer.Ordinal)
    {
        "POST /api/v1/babies",
        "POST /api/v1/babies/{babyId:guid}/invites",
        "GET /api/v1/babies/{babyId:guid}/invites",
        "DELETE /api/v1/babies/{babyId:guid}/invites/{inviteId:guid}",
        "POST /api/v1/invites/accept",
        "POST /api/v1/invites/{token}/accept",
        "POST /api/v1/catalog/products",
        "GET /api/v1/address/lookup",
        "GET /api/v1/address/search",
        "GET /api/v1/babies/{babyId:guid}/export",
        "POST /api/v1/babies/{babyId:guid}/import/napper/preview",
        "POST /api/v1/babies/{babyId:guid}/import/napper",
        "POST /api/v1/babies/{babyId:guid}/import/backup/preview",
        "POST /api/v1/babies/{babyId:guid}/import/backup",
        "POST /api/v1/babies/import/preview",
        "POST /api/v1/babies/import",
        "POST /api/v1/push/subscriptions",
        "PUT /api/v1/push/settings",
        "POST /api/v1/push/test",
        "PUT /api/v1/babies/{babyId:guid}/notification-preferences",
        "PUT /api/v1/me/assistant-settings",
        "PUT /api/v1/me/consents/optional/{kind}",
        "GET /api/v1/doctor/patients",
        "GET /api/v1/babies/{babyId:guid}/data-store",
        "PUT /api/v1/babies/{babyId:guid}/data-store",
        "DELETE /api/v1/babies/{babyId:guid}/data-store",
        "POST /api/v1/babies/{babyId:guid}/data-store/test",
        "POST /api/v1/babies/{babyId:guid}/data-store/move-in",
        "POST /api/v1/babies/{babyId:guid}/data-store/move-out",
    };

    public static bool IsBlocked(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return context.GetEndpoint() is RouteEndpoint { RoutePattern.RawText: { } pattern } && Keys.Contains($"{context.Request.Method} {pattern}");
    }
}

/// <summary>Refuses a blocked route to a demo user with 403 <c>demo_not_available</c>, before the handler runs.</summary>
internal sealed class DemoGateMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, ICurrentUser currentUser)
    {
        if (context.User.Identity?.IsAuthenticated == true && DemoBlockedRoutes.IsBlocked(context) && currentUser.IsAuthenticated)
        {
            var user = await currentUser.GetUserAsync(context.RequestAborted);
            if (user.IsDemo)
            {
                throw new DemoNotAvailableException();
            }
        }

        await next(context);
    }
}
