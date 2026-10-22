using Lotties.Api.Authorization;
using Lotties.Application.Notes;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The notes of one baby (offline sync: idempotent upsert by client GUID, delta pull, soft delete;
/// docs/design/16-doctor-access.md). Reads need <see cref="BabyPolicies.Read"/> (from the baby group) and return only
/// the notes visible to the caller (shared ones, and her own private ones); writes need <see cref="BabyPolicies.Note"/>
/// (the Doctor), and only the author changes a note.
/// </summary>
internal static class NoteEndpoints
{
    private const string NotesPath = "/notes";
    private const string NotePath = NotesPath + "/{noteId:guid}";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /notes?since=</c> (deleted included), <c>GET /notes/{noteId}</c> (404 when
    /// not visible), <c>PUT /notes/{noteId}</c> (201 created / 200 otherwise) and <c>DELETE /notes/{noteId}</c> (soft, 204).
    /// </summary>
    public static RouteGroupBuilder MapNoteEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet(NotesPath, ListChangesAsync).WithName("ListNoteChanges");
        baby.MapGet(NotePath, GetAsync).WithName("GetNote").ProducesProblem(StatusCodes.Status404NotFound);
        baby.MapPut(NotePath, UpsertAsync)
            .RequireAuthorization(BabyPolicies.Note)
            .WithName("UpsertNote")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        baby.MapDelete(NotePath, DeleteAsync)
            .RequireAuthorization(BabyPolicies.Note)
            .WithName("DeleteNote")
            .ProducesProblem(StatusCodes.Status403Forbidden);
        return baby;
    }

    private static async Task<Ok<IReadOnlyList<NoteResponse>>> ListChangesAsync(Guid babyId, DateTimeOffset? since, INoteService notes, CancellationToken cancellationToken) =>
        TypedResults.Ok(await notes.ListChangesAsync(babyId, since, cancellationToken));

    private static async Task<Ok<NoteResponse>> GetAsync(Guid babyId, Guid noteId, INoteService notes, CancellationToken cancellationToken) =>
        TypedResults.Ok(await notes.GetAsync(babyId, noteId, cancellationToken));

    private static async Task<Results<Created<NoteResponse>, Ok<NoteResponse>>> UpsertAsync(
        Guid babyId,
        Guid noteId,
        UpsertNoteRequest request,
        INoteService notes,
        CancellationToken cancellationToken)
    {
        var result = await notes.UpsertAsync(babyId, noteId, request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}/babies/{babyId}{NotesPath}/{noteId}", result.Note)
            : TypedResults.Ok(result.Note);
    }

    private static async Task<NoContent> DeleteAsync(Guid babyId, Guid noteId, INoteService notes, CancellationToken cancellationToken)
    {
        await notes.DeleteAsync(babyId, noteId, cancellationToken);
        return TypedResults.NoContent();
    }
}
