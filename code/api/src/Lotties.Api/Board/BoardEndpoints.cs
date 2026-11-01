using System.Globalization;
using System.Text.Json;
using Lotties.Api.Endpoints;
using Lotties.Api.Limits;
using Lotties.Application.Board;
using Lotties.Domain.Exceptions;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Board;

/// <summary>
/// The project board's REST routes under <c>/api/v1/board</c> (docs/design/36-project-board.md section 3). Every route
/// needs <see cref="BoardPolicies.Read"/> (a board realm role or a board API key; no baby is involved), writes
/// <see cref="BoardPolicies.Write"/>, topics, restore and API keys <see cref="BoardPolicies.Admin"/>. Every route is 404
/// while the board is disabled (<see cref="BoardRequestGuard"/>), is rate limited per user or per key
/// (<see cref="RequestLimitPolicies.Board"/>) and has the board body size limit.
/// </summary>
internal static class BoardEndpoints
{
    public const string Prefix = "/board";
    private const string ItemPath = "/items/{id:guid}";

    public static RouteGroupBuilder MapBoardEndpoints(this RouteGroupBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        var board = api.MapGroup(Prefix)
            .RequireAuthorization(BoardPolicies.Read)
            .RequireRateLimiting(RequestLimitPolicies.Board)
            .WithMetadata(BoardEndpointMetadata.Instance, BoardRequestLimitsMetadata.Standard)
            .WithTags("Board");
        board.MapGet("/me", (IBoardService service) => TypedResults.Ok(service.Me()));
        board.MapGet("/topics", ListTopicsAsync);
        board.MapPut("/topics/{key}", UpsertTopicAsync).RequireAuthorization(BoardPolicies.Admin);
        board.MapGet("/items", ListItemsAsync);
        board.MapPost("/items", CreateItemAsync).RequireAuthorization(BoardPolicies.Write);
        board.MapPost("/items/bulk", BulkAsync).RequireAuthorization(BoardPolicies.Write).WithMetadata(BoardRequestLimitsMetadata.Bulk);
        board.MapGet(ItemPath, GetItemAsync);
        board.MapPatch(ItemPath, PatchItemAsync).RequireAuthorization(BoardPolicies.Write);
        board.MapPost(ItemPath + "/comments", CommentAsync).RequireAuthorization(BoardPolicies.Write);
        board.MapDelete(ItemPath, DeleteItemAsync).RequireAuthorization(BoardPolicies.Write);
        board.MapPost(ItemPath + "/restore", RestoreItemAsync).RequireAuthorization(BoardPolicies.Admin);
        board.MapGet("/summary", SummaryAsync);
        board.MapGet("/export", ExportAsync);
        board.MapGet("/keys", ListKeysAsync).RequireAuthorization(BoardPolicies.Admin);
        board.MapPost("/keys", CreateKeyAsync).RequireAuthorization(BoardPolicies.Admin);
        board.MapDelete("/keys/{id:guid}", RevokeKeyAsync).RequireAuthorization(BoardPolicies.Admin);
        return api;
    }

    private static async Task<Ok<IReadOnlyList<BoardTopicResponse>>> ListTopicsAsync(bool? includeArchived, IBoardService service, CancellationToken cancellationToken) =>
        TypedResults.Ok(await service.ListTopicsAsync(includeArchived ?? false, cancellationToken));

    private static async Task<Results<Created<BoardTopicResponse>, Ok<BoardTopicResponse>>> UpsertTopicAsync(
        string key,
        UpsertBoardTopicRequest request,
        IBoardService service,
        CancellationToken cancellationToken)
    {
        var (topic, created) = await service.UpsertTopicAsync(key, request, cancellationToken);
        return created ? TypedResults.Created($"{ApiEndpoints.V1Prefix}{Prefix}/topics/{topic.Key}", topic) : TypedResults.Ok(topic);
    }

    private static async Task<Ok<BoardItemPageResponse>> ListItemsAsync(
        string[]? topic,
        string[]? type,
        string[]? status,
        string[]? side,
        string[]? priority,
        string[]? label,
        bool? pinned,
        bool? open,
        string? q,
        DateTimeOffset? updatedSince,
        string? dueBefore,
        string? dueAfter,
        bool? hasDue,
        bool? includeDeleted,
        string? sort,
        int? limit,
        string? cursor,
        IBoardService service,
        CancellationToken cancellationToken)
    {
        var request = new BoardItemListRequest
        {
            Topics = Split(topic),
            Types = Split(type),
            Statuses = Split(status),
            Sides = Split(side),
            Priorities = Split(priority),
            Labels = Split(label),
            Pinned = pinned,
            Open = open,
            Q = q,
            UpdatedSince = updatedSince,
            DueBefore = dueBefore,
            DueAfter = dueAfter,
            HasDue = hasDue,
            IncludeDeleted = includeDeleted ?? false,
            Sort = sort,
            Limit = limit,
            Cursor = cursor,
        };
        return TypedResults.Ok(await service.ListItemsAsync(request, cancellationToken));
    }

    private static async Task<Ok<BoardItemDetailResponse>> GetItemAsync(Guid id, IBoardService service, HttpContext context, CancellationToken cancellationToken)
    {
        var detail = await service.GetItemAsync(id, cancellationToken);
        SetETag(context, detail.Item.Version);
        return TypedResults.Ok(detail);
    }

    private static async Task<Results<Created<BoardItemResponse>, Ok<BoardItemResponse>>> CreateItemAsync(
        JsonElement body,
        IBoardService service,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var (item, created) = await service.CreateItemAsync(body, cancellationToken);
        SetETag(context, item.Version);
        return created ? TypedResults.Created($"{ApiEndpoints.V1Prefix}{Prefix}/items/{item.Id}", item) : TypedResults.Ok(item);
    }

    private static async Task<Ok<BoardItemResponse>> PatchItemAsync(Guid id, JsonElement body, IBoardService service, HttpContext context, CancellationToken cancellationToken)
    {
        var item = await service.PatchItemAsync(id, body, IfMatchVersion(context.Request), cancellationToken);
        SetETag(context, item.Version);
        return TypedResults.Ok(item);
    }

    private static async Task<Created<BoardItemEventResponse>> CommentAsync(Guid id, BoardCommentRequest request, IBoardService service, CancellationToken cancellationToken)
    {
        var entry = await service.CommentAsync(id, request, cancellationToken);
        return TypedResults.Created($"{ApiEndpoints.V1Prefix}{Prefix}/items/{id}", entry);
    }

    private static async Task<NoContent> DeleteItemAsync(Guid id, IBoardService service, CancellationToken cancellationToken)
    {
        await service.DeleteItemAsync(id, cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<Ok<BoardItemResponse>> RestoreItemAsync(Guid id, IBoardService service, HttpContext context, CancellationToken cancellationToken)
    {
        var item = await service.RestoreItemAsync(id, cancellationToken);
        SetETag(context, item.Version);
        return TypedResults.Ok(item);
    }

    private static async Task<Ok<BoardBulkResponse>> BulkAsync(JsonElement body, IBoardService service, CancellationToken cancellationToken) =>
        TypedResults.Ok(await service.BulkAsync(body, cancellationToken));

    private static async Task<Ok<BoardSummaryResponse>> SummaryAsync(int? top, IBoardService service, CancellationToken cancellationToken) =>
        TypedResults.Ok(await service.SummaryAsync(top, cancellationToken));

    private static async Task<Ok<BoardExportResponse>> ExportAsync(IBoardService service, HttpContext context, CancellationToken cancellationToken)
    {
        var export = await service.ExportAsync(cancellationToken);
        context.Response.Headers.CacheControl = "no-store";
        return TypedResults.Ok(export);
    }

    private static async Task<Ok<IReadOnlyList<BoardApiKeyResponse>>> ListKeysAsync(IBoardApiKeyService keys, CancellationToken cancellationToken) =>
        TypedResults.Ok(await keys.ListAsync(cancellationToken));

    private static async Task<Created<CreatedBoardApiKeyResponse>> CreateKeyAsync(CreateBoardApiKeyRequest request, IBoardApiKeyService keys, HttpContext context, CancellationToken cancellationToken)
    {
        var created = await keys.CreateAsync(request, cancellationToken);
        context.Response.Headers.CacheControl = "no-store";
        return TypedResults.Created($"{ApiEndpoints.V1Prefix}{Prefix}/keys/{created.Key.Id}", created);
    }

    private static async Task<NoContent> RevokeKeyAsync(Guid id, IBoardApiKeyService keys, CancellationToken cancellationToken)
    {
        await keys.RevokeAsync(id, cancellationToken);
        return TypedResults.NoContent();
    }

    /// <summary>Repeated values and comma-separated values alike (<c>?status=open,blocked&amp;status=waiting</c>).</summary>
    private static IReadOnlyList<string>? Split(string[]? values) =>
        values is null
            ? null
            : values.SelectMany(value => value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)).ToArray() is { Length: > 0 } split ? split : null;

    private static void SetETag(HttpContext context, int version) =>
        context.Response.Headers.ETag = $"\"{version.ToString(CultureInfo.InvariantCulture)}\"";

    /// <summary>The version of <c>If-Match: "3"</c> (also <c>W/"3"</c> or <c>3</c>); <c>null</c> without the header or for <c>*</c>.</summary>
    private static int? IfMatchVersion(HttpRequest request)
    {
        var header = request.Headers.IfMatch.ToString().Trim();
        if (header.Length == 0 || header == "*")
        {
            return null;
        }

        var value = header.StartsWith("W/", StringComparison.Ordinal) ? header[2..] : header;
        return int.TryParse(value.Trim('"'), NumberStyles.None, CultureInfo.InvariantCulture, out var version) && version > 0
            ? version
            : throw new DomainValidationException("If-Match", "If-Match must be the item's ETag, e.g. \"3\".");
    }
}
