using Lotties.Api.Authorization;
using Lotties.Application.Clinical;
using Lotties.Application.Events;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The doctor's lean views of one baby (docs/design/19-doctor-dashboard.md): the clinical summary of a range of local days and the
/// day timeline. Both are reads of the baby group (<see cref="BabyPolicies.Read"/>, so the access log records a Doctor's visit).
/// The summary is open to every member and filters its own sections by the caller's scopes; the timeline is the daily log, so a
/// Doctor needs <see cref="BabyPolicies.ScopeDailyLog"/>.
/// </summary>
internal static class ClinicalEndpoints
{
    private const string SummaryPath = "/clinical-summary";
    private const string TimelinePath = "/timeline";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /clinical-summary?from=&amp;to=&amp;timeZone=&amp;utcOffsetMinutes=</c> (400 for a range that is
    /// missing, reversed or longer than 92 days) and <c>GET /timeline?from=&amp;to=</c> (the non-deleted events overlapping the
    /// instants, 400 for a span longer than 8 days).
    /// </summary>
    public static RouteGroupBuilder MapClinicalEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(SummaryPath, GetSummaryAsync)
            .WithName("GetClinicalSummary")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        baby.MapGet(TimelinePath, GetTimelineAsync)
            .RequireAuthorization(BabyPolicies.ScopeDailyLog)
            .WithName("GetTimeline")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        return baby;
    }

    private static async Task<Results<Ok<ClinicalSummaryResponse>, ValidationProblem>> GetSummaryAsync(
        Guid babyId,
        string? from,
        string? to,
        string? timeZone,
        int? utcOffsetMinutes,
        IClinicalSummaryService summaries,
        CancellationToken cancellationToken)
    {
        if (!UtcOffsetQuery.IsValid(utcOffsetMinutes))
        {
            return UtcOffsetQuery.Invalid();
        }

        var request = new ClinicalSummaryRequest(from, to, timeZone, UtcOffsetQuery.ToOffset(utcOffsetMinutes));
        return TypedResults.Ok(await summaries.GetAsync(babyId, request, cancellationToken));
    }

    private static async Task<Ok<IReadOnlyList<EventResponse>>> GetTimelineAsync(
        Guid babyId,
        DateTimeOffset? from,
        DateTimeOffset? to,
        ITimelineService timeline,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await timeline.ListAsync(babyId, from, to, cancellationToken));
}
