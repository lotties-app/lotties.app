using Lotties.Application.Rhythm;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The baby's rhythm (docs/design/48-baby-rhythm.md), computed on request and never stored. Roles exactly as the
/// predictions: <see cref="Authorization.BabyPolicies.Read"/> (from the baby group, Viewer included) and, for a Doctor,
/// the daily log scope (<see cref="Authorization.BabyPolicies.ScopeDailyLog"/>).
/// </summary>
internal static class RhythmEndpoints
{
    private const string RhythmPath = "/rhythm";

    /// <summary>Maps <c>GET /rhythm?utcOffsetMinutes=&amp;timeZone=</c> under the baby-scoped group.</summary>
    public static RouteGroupBuilder MapRhythmEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(RhythmPath, GetAsync)
            .RequireAuthorization(Authorization.BabyPolicies.ScopeDailyLog)
            .WithName("GetRhythm");
        return baby;
    }

    private static async Task<Results<Ok<RhythmResponse>, ValidationProblem, NotFound>> GetAsync(
        Guid babyId,
        int? utcOffsetMinutes,
        string? timeZone,
        IRhythmService rhythm,
        TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        if (!UtcOffsetQuery.IsValid(utcOffsetMinutes))
        {
            return UtcOffsetQuery.Invalid();
        }

        var now = timeProvider.GetUtcNow().ToOffset(UtcOffsetQuery.ToOffset(utcOffsetMinutes));
        var response = await rhythm.GetAsync(babyId, now, timeZone, cancellationToken);
        return response is null ? TypedResults.NotFound() : TypedResults.Ok(response);
    }
}
