using Lotties.Api.Consents;
using Lotties.Api.Limits;
using Lotties.Application.Demo;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The try-it demo (docs/design/45-try-it-demo.md): both routes are anonymous by nature and exempt from the consent gate (the account
/// they create gets its demo consent in the same request).
/// </summary>
internal static class DemoEndpoints
{
    private const string Path = "/demo";

    private const string Reason = "The demo is reached before any account exists; it carries no baby data of a real person.";

    /// <summary>
    /// Maps <c>GET /demo</c> (<c>{ enabled, lifetimeDays }</c>) and <c>POST /demo/start</c> (201 with the token and the sample baby; 404
    /// <c>demo_disabled</c>, 429 per address and hour, 503 <c>demo_capacity</c>).
    /// </summary>
    public static IEndpointRouteBuilder MapDemoEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        var demo = api.MapGroup(Path).AllowAnonymous().AllowWithoutConsent(Reason);
        demo.MapGet(string.Empty, GetStatus)
            .WithName("GetDemoStatus");
        demo.MapPost("/start", StartAsync)
            .RequireRateLimiting(RequestLimitPolicies.DemoStart)
            .WithName("StartDemo")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status429TooManyRequests)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);
        return api;
    }

    private static Ok<DemoStatusResponse> GetStatus(IDemoService demo) => TypedResults.Ok(demo.GetStatus());

    private static async Task<Created<StartDemoResponse>> StartAsync(StartDemoRequest? request, IDemoService demo, CancellationToken cancellationToken) =>
        TypedResults.Created("/api/v1/demo", await demo.StartAsync(request ?? new StartDemoRequest(), cancellationToken));
}
