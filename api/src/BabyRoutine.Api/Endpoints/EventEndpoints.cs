using BabyRoutine.Api.Authorization;
using BabyRoutine.Application.Events;
using Microsoft.AspNetCore.Http.HttpResults;

namespace BabyRoutine.Api.Endpoints;

/// <summary>
/// Events of one baby, for offline sync: idempotent upsert by client GUID, soft delete and a paged delta pull.
/// Reads need <see cref="BabyPolicies.Read"/> (from the baby group), writes <see cref="BabyPolicies.Write"/>.
/// </summary>
internal static class EventEndpoints
{
    /// <summary>Response header of the delta pull carrying the cursor of the next page; absent on the last page.</summary>
    public const string NextCursorHeader = "X-Next-Cursor";

    private const string EventsPath = "/events";
    private const string EventPath = EventsPath + "/{eventId:guid}";

    /// <summary>
    /// Maps, under the baby-scoped group:
    /// <c>GET /events?since=&amp;after=&amp;limit=</c> (delta, soft-deleted included, ordered by updatedAt then id),
    /// <c>GET /events/{eventId}</c>, <c>PUT /events/{eventId}</c> (201 created / 200 otherwise) and
    /// <c>DELETE /events/{eventId}</c> (204, idempotent).
    /// </summary>
    public static RouteGroupBuilder MapEventEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(EventsPath, ListChangesAsync)
            .WithName("ListEventChanges")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        baby.MapGet(EventPath, GetAsync)
            .WithName("GetEvent")
            .ProducesProblem(StatusCodes.Status404NotFound);
        baby.MapPut(EventPath, UpsertAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("UpsertEvent")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        baby.MapDelete(EventPath, DeleteAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("DeleteEvent");
        return baby;
    }

    private static async Task<Ok<IReadOnlyList<EventResponse>>> ListChangesAsync(
        Guid babyId,
        DateTimeOffset? since,
        string? after,
        int? limit,
        IEventService events,
        HttpResponse response,
        CancellationToken cancellationToken)
    {
        var page = await events.ListChangesAsync(babyId, new ListEventChangesRequest(since, after, limit), cancellationToken);
        AddNextCursor(response, page.NextCursor);
        return TypedResults.Ok(page.Items);
    }

    private static async Task<Ok<EventResponse>> GetAsync(Guid babyId, Guid eventId, IEventService events, CancellationToken cancellationToken) =>
        TypedResults.Ok(await events.GetAsync(babyId, eventId, cancellationToken));

    private static async Task<Results<Created<EventResponse>, Ok<EventResponse>>> UpsertAsync(
        Guid babyId,
        Guid eventId,
        UpsertEventRequest request,
        IEventService events,
        CancellationToken cancellationToken)
    {
        var result = await events.UpsertAsync(babyId, eventId, request, cancellationToken);
        return result.Created
            ? TypedResults.Created(EventLocation(babyId, eventId), result.Event)
            : TypedResults.Ok(result.Event);
    }

    private static async Task<NoContent> DeleteAsync(Guid babyId, Guid eventId, IEventService events, CancellationToken cancellationToken)
    {
        await events.DeleteAsync(babyId, eventId, cancellationToken);
        return TypedResults.NoContent();
    }

    private static string EventLocation(Guid babyId, Guid eventId) => $"{ApiEndpoints.V1Prefix}/babies/{babyId}/events/{eventId}";

    private static void AddNextCursor(HttpResponse response, string? nextCursor)
    {
        if (nextCursor is not null)
        {
            response.Headers[NextCursorHeader] = nextCursor;
        }
    }
}
