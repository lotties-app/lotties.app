using System.Globalization;
using Lotties.Api.Authorization;
using Lotties.Application.Stores;

namespace Lotties.Api.Stores;

/// <summary>
/// Binds the route's baby to its data store for the request (docs/design/47-bring-your-own-database.md section 3.6): an endpoint
/// filter of the <c>/babies/{babyId}</c> group, so it runs after authentication, the baby policies and the consent gate, and only
/// for a caller they let through. It enters the baby in the request's <see cref="IStoreScope"/> (a store that cannot be used is
/// <c>503 store_unavailable</c>, never the built-in store) and sends the baby's store epoch in <see cref="SyncEpochHeader"/>.
/// </summary>
internal static class StoreScopeEndpointFilter
{
    /// <summary>
    /// The baby's store epoch (decimal, 0 for a baby that never moved), on every response of a <c>/babies/{babyId}</c> route; it
    /// changes when the baby's records move to another store, and a client holding another value pulls everything again. Additive:
    /// clients that do not know it ignore it. Exposed to cross-origin clients.
    /// </summary>
    public const string SyncEpochHeader = "X-Sync-Epoch";

    public static async ValueTask<object?> BindAsync(EndpointFilterInvocationContext invocation, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(invocation);
        ArgumentNullException.ThrowIfNull(next);
        var http = invocation.HttpContext;
        if (BabyRouteValues.ReadBabyId(http) is { } babyId)
        {
            var stores = http.RequestServices.GetRequiredService<IStoreScope>();
            await stores.EnterAsync(babyId, http.RequestAborted);
            http.Response.Headers[SyncEpochHeader] = stores.RouteOf(babyId).Epoch.ToString(CultureInfo.InvariantCulture);
        }

        return await next(invocation);
    }
}
