using Lotties.Application.Predictions;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// Records user feedback on a prediction's accuracy, a write into the baby's accuracy records. Needs
/// <see cref="Authorization.BabyPolicies.Log"/>, like an event write: an Owner, a Parent or a Caregiver; never a Viewer, and
/// never a Doctor (her writes are only her notes and consultation measurements).
/// </summary>
internal static class PredictionFeedbackEndpoint
{
    private const string FeedbackPath = "/predictions/feedback";

    /// <summary>Maps <c>POST /predictions/feedback</c> under the baby-scoped group.</summary>
    public static RouteGroupBuilder MapPredictionFeedbackEndpoint(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapPost(FeedbackPath, PostAsync)
            .RequireAuthorization(Authorization.BabyPolicies.Log)
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
    /// <summary>
    /// The prediction being rated, <c>typeKey:instant</c>: the instant is the prediction's expected next start as an ISO 8601
    /// UTC date and time (what the web sends, e.g. <c>feeding:2026-11-25T13:00:00.000Z</c>) or, the older form, UTC ticks of
    /// when it was predicted. Both are accepted.
    /// </summary>
    public string PredictionId { get; set; } = string.Empty;

    /// <summary><c>true</c> when the prediction matched what happened, <c>false</c> otherwise.</summary>
    public bool Accurate { get; set; }
}