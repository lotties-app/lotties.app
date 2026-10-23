using Lotties.Api.Authorization;
using Lotties.Application.EventTypes;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// Event types of one baby: built-in templates (read-only) plus the baby's custom types. Reads need
/// <see cref="BabyPolicies.Read"/> (from the baby group) and, for a Doctor, the daily log scope
/// (<see cref="BabyPolicies.ScopeDailyLog"/>); writes <see cref="BabyPolicies.Write"/>.
/// </summary>
internal static class EventTypeEndpoints
{
    private const string EventTypesPath = "/event-types";
    private const string EventTypePath = EventTypesPath + "/{eventTypeId:guid}";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /event-types</c>, <c>POST /event-types</c> (201),
    /// <c>PUT /event-types/{eventTypeId}</c> and <c>DELETE /event-types/{eventTypeId}</c> (204). Built-ins reject writes
    /// with 409 <c>event_type_built_in_read_only</c>; a type used by events cannot be deleted (409 <c>event_type_in_use</c>).
    /// </summary>
    public static RouteGroupBuilder MapEventTypeEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(EventTypesPath, ListAsync)
            .RequireAuthorization(BabyPolicies.ScopeDailyLog)
            .WithName("ListEventTypes");
        baby.MapPost(EventTypesPath, CreateAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("CreateEventType")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        baby.MapPut(EventTypePath, UpdateAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("UpdateEventType")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        baby.MapDelete(EventTypePath, DeleteAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("DeleteEventType")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        return baby;
    }

    private static async Task<Ok<IReadOnlyList<EventTypeResponse>>> ListAsync(Guid babyId, IEventTypeService eventTypes, CancellationToken cancellationToken) =>
        TypedResults.Ok(await eventTypes.ListAsync(babyId, cancellationToken));

    private static async Task<Created<EventTypeResponse>> CreateAsync(
        Guid babyId,
        CreateEventTypeRequest request,
        IEventTypeService eventTypes,
        CancellationToken cancellationToken)
    {
        var created = await eventTypes.CreateAsync(babyId, request, cancellationToken);
        return TypedResults.Created($"{ApiEndpoints.V1Prefix}/babies/{babyId}{EventTypesPath}/{created.Id}", created);
    }

    private static async Task<Ok<EventTypeResponse>> UpdateAsync(
        Guid babyId,
        Guid eventTypeId,
        UpdateEventTypeRequest request,
        IEventTypeService eventTypes,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await eventTypes.UpdateAsync(babyId, eventTypeId, request, cancellationToken));

    private static async Task<NoContent> DeleteAsync(Guid babyId, Guid eventTypeId, IEventTypeService eventTypes, CancellationToken cancellationToken)
    {
        await eventTypes.DeleteAsync(babyId, eventTypeId, cancellationToken);
        return TypedResults.NoContent();
    }
}
