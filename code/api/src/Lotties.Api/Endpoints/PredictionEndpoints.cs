using Lotties.Application.Predictions;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// Computed predictions of one baby. Needs <see cref="Authorization.BabyPolicies.Read"/> (from the baby group) and, for a
/// Doctor, the daily log scope (<see cref="Authorization.BabyPolicies.ScopeDailyLog"/>).
/// </summary>
internal static class PredictionEndpoints
{
    /// <summary>Optional query parameter: the family's current UTC offset in minutes (e.g. <c>-180</c>), used to tell day from night.</summary>
    public const string UtcOffsetMinutesParameter = "utcOffsetMinutes";

    /// <summary>
    /// Optional query parameter: the family's IANA time zone (e.g. <c>America/Sao_Paulo</c>) for the recurring patterns;
    /// an unknown id falls back to <see cref="UtcOffsetMinutesParameter"/>.
    /// </summary>
    public const string TimeZoneParameter = "timeZone";

    /// <summary>Largest UTC offset in use (±14h), which is also the range <see cref="DateTimeOffset"/> accepts.</summary>
    public const int MaxUtcOffsetMinutes = 14 * 60;

    private const string PredictionsPath = "/predictions";

    /// <summary>Maps <c>GET /predictions?utcOffsetMinutes=&amp;timeZone=</c> under the baby-scoped group.</summary>
    public static RouteGroupBuilder MapPredictionEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(PredictionsPath, GetAsync)
            .RequireAuthorization(Authorization.BabyPolicies.ScopeDailyLog)
            .WithName("GetPredictions");
        return baby;
    }

    private static async Task<Results<Ok<PredictionsResponse>, ValidationProblem, NotFound>> GetAsync(
        Guid babyId,
        int? utcOffsetMinutes,
        string? timeZone,
        IPredictionService predictions,
        TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        if (utcOffsetMinutes is < -MaxUtcOffsetMinutes or > MaxUtcOffsetMinutes)
        {
            return InvalidOffset();
        }

        var now = timeProvider.GetUtcNow().ToOffset(TimeSpan.FromMinutes(utcOffsetMinutes ?? 0));
        var response = await predictions.GetAsync(babyId, now, timeZone, cancellationToken);
        return response is null ? TypedResults.NotFound() : TypedResults.Ok(response);
    }

    private static ValidationProblem InvalidOffset() => TypedResults.ValidationProblem(new Dictionary<string, string[]>
    {
        [UtcOffsetMinutesParameter] = [$"Must be between -{MaxUtcOffsetMinutes} and {MaxUtcOffsetMinutes}."],
    });
}
