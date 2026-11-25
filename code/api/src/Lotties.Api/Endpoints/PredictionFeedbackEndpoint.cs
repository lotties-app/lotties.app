using Lotties.Application.Predictions;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// Records user feedback on a prediction's accuracy. Needs <see cref="Authorization.BabyPolicies.Read"/> (from the baby
/// group): any member of the baby may report whether a prediction was accurate; a Doctor, like for the predictions themselves,
/// only with the daily log scope (<see cref="Authorization.BabyPolicies.ScopeDailyLog"/>).
/// </summary>
internal static class PredictionFeedbackEndpoint
{
    private const string FeedbackPath = "/predictions/feedback";

    /// <summary>Maps <c>POST /predictions/feedback</c> under the baby-scoped group.</summary>
    public static RouteGroupBuilder MapPredictionFeedbackEndpoint(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapPost(FeedbackPath, PostAsync)
            .RequireAuthorization(Authorization.BabyPolicies.ScopeDailyLog)
            .WithName("PostPredictionFeedback");
        return baby;
    }

    private static async Task<Results<NoContent, ValidationProblem>> PostAsync(
        Guid babyId,
        PredictionFeedbackRequest request,
        IPredictionOutcomeResolutionService resolution,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.PredictionId))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                [nameof(request.PredictionId)] = ["A prediction identifier is required."],
            });
        }

        await resolution.RecordFeedbackAsync(babyId, request.PredictionId, request.Accurate, cancellationToken);
        return TypedResults.NoContent();
    }
}

/// <summary>The body of <c>POST /api/v1/babies/{babyId}/predictions/feedback</c>.</summary>
public sealed class PredictionFeedbackRequest
{
    /// <summary>Stable identifier of the prediction being rated (type key + anchor timestamp).</summary>
    public string PredictionId { get; set; } = string.Empty;

    /// <summary><c>true</c> when the prediction matched what happened, <c>false</c> otherwise.</summary>
    public bool Accurate { get; set; }
}