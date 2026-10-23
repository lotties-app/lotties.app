using Lotties.Api.Endpoints;

namespace Lotties.Api.Authorization;

/// <summary>Reads the <c>{babyId}</c> route value the baby-scoped policies are evaluated against.</summary>
internal static class BabyRouteValues
{
    /// <summary>The route's baby id, or <c>null</c> when the route has none or it is not a GUID.</summary>
    public static Guid? ReadBabyId(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);
        return Guid.TryParse(httpContext.GetRouteValue(BabyRoutes.BabyIdParameter)?.ToString(), out var babyId) ? babyId : null;
    }
}
