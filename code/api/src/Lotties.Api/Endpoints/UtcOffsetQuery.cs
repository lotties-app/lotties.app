using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>The optional <c>utcOffsetMinutes</c> query parameter (the family's current UTC offset) that the doctor's views share with the predictions.</summary>
internal static class UtcOffsetQuery
{
    /// <summary>Whether the offset is absent or within ±14 hours (<see cref="PredictionEndpoints.MaxUtcOffsetMinutes"/>).</summary>
    public static bool IsValid(int? utcOffsetMinutes) =>
        utcOffsetMinutes is null or (>= -PredictionEndpoints.MaxUtcOffsetMinutes and <= PredictionEndpoints.MaxUtcOffsetMinutes);

    public static TimeSpan ToOffset(int? utcOffsetMinutes) => TimeSpan.FromMinutes(utcOffsetMinutes ?? 0);

    /// <summary>The 400 answer for an offset out of range, like the predictions endpoint's.</summary>
    public static ValidationProblem Invalid() => TypedResults.ValidationProblem(new Dictionary<string, string[]>
    {
        [PredictionEndpoints.UtcOffsetMinutesParameter] = [$"Must be between -{PredictionEndpoints.MaxUtcOffsetMinutes} and {PredictionEndpoints.MaxUtcOffsetMinutes}."],
    });
}
