using BabyRoutine.Api.Authorization;
using BabyRoutine.Api.Endpoints;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace BabyRoutine.Api.Tests.Support;

/// <summary>
/// Adds test-only endpoints in the real baby-scoped group (<see cref="BabyRoutes.MapBabyScopedGroup"/>) under
/// <c>/probe</c>, one per policy, so the policies can be exercised over HTTP before feature endpoints exist.
/// </summary>
internal sealed class ProbeEndpointsStartupFilter : IStartupFilter
{
    public const string Prefix = "/probe";

    public static string ReadPath(Guid babyId) => $"{Prefix}/babies/{babyId}/read";

    public static string WritePath(Guid babyId) => $"{Prefix}/babies/{babyId}/write";

    public static string ManageMembersPath(Guid babyId) => $"{Prefix}/babies/{babyId}/members";

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.MapWhen(context => context.Request.Path.StartsWithSegments(Prefix), MapProbePipeline);
        next(app);
    };

    private static void MapProbePipeline(IApplicationBuilder branch)
    {
        branch.UseRouting();
        branch.UseAuthentication();
        branch.UseAuthorization();
        branch.UseEndpoints(MapProbeEndpoints);
    }

    private static void MapProbeEndpoints(IEndpointRouteBuilder endpoints)
    {
        var baby = endpoints.MapGroup(Prefix).RequireAuthorization().MapBabyScopedGroup();
        baby.MapGet("/read", () => Results.Ok());
        baby.MapPost("/write", () => Results.Ok()).RequireAuthorization(BabyPolicies.Write);
        baby.MapPost("/members", () => Results.Ok()).RequireAuthorization(BabyPolicies.ManageMembers);
    }
}
