using System.Text.Json;
using Lotties.Domain.Board;
using Lotties.Domain.Exceptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Board;

/// <summary>
/// The project board's use cases (docs/design/36-project-board.md): topics, items, history, bulk import, summary and
/// export. The route policies already admitted the caller (read, write or admin); here the finer rules apply: a key
/// limited to topics sees and writes only those, deleted items are for admins, versions guard concurrent edits.
/// </summary>
public interface IBoardService
{
    BoardMeResponse Me();

    Task<IReadOnlyList<BoardTopicResponse>> ListTopicsAsync(bool includeArchived, CancellationToken cancellationToken = default);

    Task<(BoardTopicResponse Topic, bool Created)> UpsertTopicAsync(string key, UpsertBoardTopicRequest request, CancellationToken cancellationToken = default);

    Task<BoardItemPageResponse> ListItemsAsync(BoardItemListRequest request, CancellationToken cancellationToken = default);

    Task<BoardItemDetailResponse> GetItemAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>Creates an item; an <c>id</c> or <c>externalKey</c> that exists returns the stored item (<c>Created</c> false).</summary>
    Task<(BoardItemResponse Item, bool Created)> CreateItemAsync(JsonElement body, CancellationToken cancellationToken = default);

    /// <summary>Merge patch; <paramref name="ifMatch"/> (or the body's <c>version</c>) must be the stored version when given.</summary>
    Task<BoardItemResponse> PatchItemAsync(Guid id, JsonElement body, int? ifMatch, CancellationToken cancellationToken = default);

    Task<BoardItemEventResponse> CommentAsync(Guid id, BoardCommentRequest request, CancellationToken cancellationToken = default);

    Task DeleteItemAsync(Guid id, CancellationToken cancellationToken = default);

    Task<BoardItemResponse> RestoreItemAsync(Guid id, CancellationToken cancellationToken = default);

    Task<BoardBulkResponse> BulkAsync(JsonElement body, CancellationToken cancellationToken = default);

    Task<BoardSummaryResponse> SummaryAsync(int? top, CancellationToken cancellationToken = default);

    Task<BoardExportResponse> ExportAsync(CancellationToken cancellationToken = default);
}

internal sealed class BoardService(IBoardRepository board, IBoardCaller caller, TimeProvider timeProvider, ILogger<BoardService> logger) : IBoardService
{
    public const int MaxBulkItems = 100;
    public const int DefaultLimit = 50;
    public const int MaxLimit = 200;
    public const int DefaultTop = 10;
    public const int MaxTop = 50;
    public const int MaxSearchLength = 200;

    private BoardAccess Access => caller.Access;

    public BoardMeResponse Me() => new(
        BoardCodes.ToCode(Access.Kind),
        Access.Name,
        Access.Roles,
        Access.Scope is { } scope ? BoardCodes.ToCode(scope) : null,
        Access.KeyId,
        Access.CanRead,
        Access.CanWrite,
        Access.CanAdmin,
        Access.AllowedTopics);

    public async Task<IReadOnlyList<BoardTopicResponse>> ListTopicsAsync(bool includeArchived, CancellationToken cancellationToken = default)
    {
        var topics = await board.ListTopicsAsync(cancellationToken);
        return topics
            .Where(topic => (includeArchived || !topic.Archived) && Access.AllowsTopic(topic.Key))
            .Select(topic => (BoardTopicResponse)topic)
            .ToArray();
    }

    public async Task<(BoardTopicResponse Topic, bool Created)> UpsertTopicAsync(string key, UpsertBoardTopicRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureAdmin("manage topics");
        var topicKey = BoardTopicKeys.Required(key, "key");
        var now = timeProvider.GetUtcNow();
        var existing = await board.FindTopicAsync(topicKey, cancellationToken);
        if (existing is not null)
        {
            if (existing.Edit(request.Name ?? string.Empty, request.Description, request.SortOrder ?? existing.SortOrder, request.Archived ?? existing.Archived, now))
            {
                await board.SaveChangesAsync(cancellationToken);
                logger.LogInformation("Board topic {TopicKey} updated", topicKey);
            }

            return ((BoardTopicResponse)existing, false);
        }

        var sortOrder = request.SortOrder ?? ((await board.ListTopicsAsync(cancellationToken)).Select(topic => topic.SortOrder).DefaultIfEmpty(0).Max() + 10);
        var topic = BoardTopic.Create(topicKey, request.Name ?? string.Empty, request.Description, sortOrder, request.Archived ?? false, now);
        board.AddTopic(topic);
        await board.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Board topic {TopicKey} created", topicKey);
        return ((BoardTopicResponse)topic, true);
    }

    public async Task<BoardItemPageResponse> ListItemsAsync(BoardItemListRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.IncludeDeleted && !Access.CanAdmin)
        {
            throw new BoardAdminRequiredException("list deleted items");
        }

        var sort = request.Sort is null ? BoardItemSort.Updated : BoardCodes.Parse<BoardItemSort>(request.Sort, "sort");
        var limit = request.Limit ?? DefaultLimit;
        if (limit is < 1 or > MaxLimit)
        {
            throw new DomainValidationException("limit", $"limit must be 1-{MaxLimit}.");
        }

        var offset = BoardCursor.Decode(request.Cursor, sort);
        var query = new BoardItemQuery
        {
            Topics = VisibleTopics(request.Topics?.Select(topic => BoardTopicKeys.Required(topic, "topic")).ToArray()),
            Types = ParseAll<BoardItemType>(request.Types, "type"),
            Statuses = ParseAll<BoardItemStatus>(request.Statuses, "status"),
            Sides = ParseAll<BoardSide>(request.Sides, "side"),
            Priorities = ParseAll<BoardPriority>(request.Priorities, "priority"),
            Labels = Labels(request.Labels),
            Pinned = request.Pinned,
            Open = request.Open,
            Search = Search(request.Q),
            UpdatedSince = request.UpdatedSince,
            IncludeDeleted = request.IncludeDeleted,
            Sort = sort,
            Offset = offset,
            Limit = limit + 1,
        };
        var items = await board.QueryItemsAsync(query, cancellationToken);
        var next = items.Count > limit ? BoardCursor.Encode(sort, offset + limit) : null;
        return new BoardItemPageResponse(items.Take(limit).Select(BoardMapping.ToSummary).ToArray(), next);
    }

    public async Task<BoardItemDetailResponse> GetItemAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var item = await board.FindItemAsync(id, cancellationToken);
        if (item is null || (item.IsDeleted && !Access.CanAdmin) || !Access.AllowsTopic(item.TopicKey))
        {
            throw new BoardItemNotFoundException(id);
        }

        var history = await board.HistoryAsync(id, cancellationToken);
        return new BoardItemDetailResponse(BoardMapping.ToResponse(item), history.Select(entry => (BoardItemEventResponse)entry).ToArray());
    }

    public async Task<(BoardItemResponse Item, bool Created)> CreateItemAsync(JsonElement body, CancellationToken cancellationToken = default)
    {
        var input = BoardItemInput.ForCreate(body);
        var content = input.ToNewContent();
        var externalKey = input.ValidExternalKey();
        var existing = (await board.FindItemsAsync(input.Id is { } id ? [id] : [], externalKey is null ? [] : [externalKey], cancellationToken)).FirstOrDefault();
        if (existing is not null)
        {
            return (BoardMapping.ToResponse(Visible(existing)), false);
        }

        await EnsureWritableTopicAsync(content.TopicKey, cancellationToken);
        var actor = await caller.GetActorAsync(cancellationToken);
        var (item, created) = BoardItem.Create(input.Id ?? Guid.NewGuid(), content, externalKey, actor, timeProvider.GetUtcNow());
        board.AddItem(item);
        board.AddEvent(created);
        await board.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Board item {ItemId} created by {ActorKind}", item.Id, BoardCodes.ToCode(actor.Kind));
        return (BoardMapping.ToResponse(item), true);
    }

    public async Task<BoardItemResponse> PatchItemAsync(Guid id, JsonElement body, int? ifMatch, CancellationToken cancellationToken = default)
    {
        var input = BoardItemInput.ForPatch(body);
        var item = await FindWritableAsync(id, cancellationToken);
        item.EnsureVersion(ifMatch ?? input.Version);
        var content = input.ApplyTo(item.Content);
        if (content.TopicKey != item.TopicKey)
        {
            await EnsureWritableTopicAsync(content.TopicKey, cancellationToken);
        }

        var actor = await caller.GetActorAsync(cancellationToken);
        if (item.Edit(content, actor, timeProvider.GetUtcNow()) is { } entry)
        {
            board.AddEvent(entry);
            await board.SaveChangesAsync(cancellationToken);
            logger.LogInformation("Board item {ItemId} {Change} by {ActorKind}", id, BoardCodes.ToCode(entry.Kind), BoardCodes.ToCode(actor.Kind));
        }

        return BoardMapping.ToResponse(item);
    }

    public async Task<BoardItemEventResponse> CommentAsync(Guid id, BoardCommentRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var item = await FindWritableAsync(id, cancellationToken);
        var actor = await caller.GetActorAsync(cancellationToken);
        var entry = item.Comment(request.Comment, actor, timeProvider.GetUtcNow());
        board.AddEvent(entry);
        await board.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Board item {ItemId} commented by {ActorKind}", id, BoardCodes.ToCode(actor.Kind));
        return (BoardItemEventResponse)entry;
    }

    public async Task DeleteItemAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var item = await FindInTopicAsync(id, cancellationToken);
        var actor = await caller.GetActorAsync(cancellationToken);
        if (item.Delete(actor, timeProvider.GetUtcNow()) is { } entry)
        {
            board.AddEvent(entry);
            await board.SaveChangesAsync(cancellationToken);
            logger.LogInformation("Board item {ItemId} deleted by {ActorKind}", id, BoardCodes.ToCode(actor.Kind));
        }
    }

    public async Task<BoardItemResponse> RestoreItemAsync(Guid id, CancellationToken cancellationToken = default)
    {
        EnsureAdmin("restore items");
        var item = await FindInTopicAsync(id, cancellationToken);
        var actor = await caller.GetActorAsync(cancellationToken);
        if (item.Restore(actor, timeProvider.GetUtcNow()) is { } entry)
        {
            board.AddEvent(entry);
            await board.SaveChangesAsync(cancellationToken);
            logger.LogInformation("Board item {ItemId} restored", id);
        }

        return BoardMapping.ToResponse(item);
    }

    public async Task<BoardBulkResponse> BulkAsync(JsonElement body, CancellationToken cancellationToken = default)
    {
        var entries = ReadBulk(body);
        foreach (var topic in entries.Select(entry => entry.Content.TopicKey).Distinct(StringComparer.Ordinal))
        {
            await EnsureWritableTopicAsync(topic, cancellationToken);
        }

        var ids = entries.Where(entry => entry.Input.Id is not null).Select(entry => entry.Input.Id!.Value).ToArray();
        var keys = entries.Where(entry => entry.ExternalKey is not null).Select(entry => entry.ExternalKey!).ToArray();
        var existing = await board.FindItemsAsync(ids, keys, cancellationToken);
        var actor = await caller.GetActorAsync(cancellationToken);
        var now = timeProvider.GetUtcNow();
        var results = entries.Select((entry, index) => Import(entry, index, existing, actor, now)).ToArray();
        await board.SaveChangesAsync(cancellationToken);
        logger.LogInformation(
            "Board bulk import by {ActorKind}: {Created} created, {Updated} updated, {Unchanged} unchanged, {Kept} kept, {Deleted} deleted",
            BoardCodes.ToCode(actor.Kind),
            results.Count(result => result.Outcome == BulkOutcomes.Created),
            results.Count(result => result.Outcome == BulkOutcomes.Updated),
            results.Count(result => result.Outcome == BulkOutcomes.Unchanged),
            results.Count(result => result.Outcome == BulkOutcomes.Kept),
            results.Count(result => result.Outcome == BulkOutcomes.Deleted));
        return new BoardBulkResponse(results);
    }

    public async Task<BoardSummaryResponse> SummaryAsync(int? top, CancellationToken cancellationToken = default)
    {
        var size = top ?? DefaultTop;
        if (size is < 1 or > MaxTop)
        {
            throw new DomainValidationException("top", $"top must be 1-{MaxTop}.");
        }

        var topics = Access.AllowedTopics;
        var now = timeProvider.GetUtcNow();
        var counts = await board.CountByTopicSideStatusAsync(topics, cancellationToken);
        var open = counts.Where(count => !BoardCodes.IsClosed(count.Status)).ToArray();
        var overdue = await board.CountItemsAsync(new BoardItemQuery { Topics = topics, Open = true, DueBefore = DateOnly.FromDateTime(now.UtcDateTime) }, cancellationToken);
        var totals = new BoardTotalsResponse(
            open.Sum(count => count.Count),
            open.Where(count => count.Side is BoardSide.Owner or BoardSide.Both).Sum(count => count.Count),
            open.Where(count => count.Side is BoardSide.Assistant or BoardSide.Both).Sum(count => count.Count),
            counts.Where(count => count.Status == BoardItemStatus.Blocked).Sum(count => count.Count),
            overdue);
        return new BoardSummaryResponse(
            now,
            totals,
            counts.Select(count => new BoardCountResponse(count.TopicKey, BoardCodes.ToCode(count.Side), BoardCodes.ToCode(count.Status), count.Count)).ToArray(),
            await SummariesAsync(new BoardItemQuery { Topics = topics, Open = true, Sides = [BoardSide.Owner, BoardSide.Both], Sort = BoardItemSort.Priority, Limit = size }, cancellationToken),
            await SummariesAsync(new BoardItemQuery { Topics = topics, Open = true, Sides = [BoardSide.Assistant, BoardSide.Both], Sort = BoardItemSort.Priority, Limit = size }, cancellationToken),
            await SummariesAsync(new BoardItemQuery { Topics = topics, Types = [BoardItemType.Decision], DecidedOnly = true, Sort = BoardItemSort.Decided, Limit = size }, cancellationToken),
            await SummariesAsync(new BoardItemQuery { Topics = topics, Sort = BoardItemSort.Updated, Limit = size }, cancellationToken));
    }

    public async Task<BoardExportResponse> ExportAsync(CancellationToken cancellationToken = default)
    {
        var topics = await ListTopicsAsync(includeArchived: true, cancellationToken);
        var query = new BoardItemQuery { Topics = Access.AllowedTopics, IncludeDeleted = Access.CanAdmin, Sort = BoardItemSort.Created };
        var items = await board.QueryItemsAsync(query, cancellationToken);
        var history = (await board.HistoryOfAsync(query, cancellationToken)).ToLookup(entry => entry.ItemId);
        logger.LogInformation("Board exported: {Items} items", items.Count);
        return new BoardExportResponse(
            BoardExportResponse.FormatName,
            BoardExportResponse.CurrentVersion,
            timeProvider.GetUtcNow(),
            topics,
            items.Select(item => new BoardExportItem(BoardMapping.ToResponse(item), history[item.Id].Select(entry => (BoardItemEventResponse)entry).ToArray())).ToArray());
    }

    private async Task<IReadOnlyList<BoardItemSummaryResponse>> SummariesAsync(BoardItemQuery query, CancellationToken cancellationToken) =>
        (await board.QueryItemsAsync(query, cancellationToken)).Select(BoardMapping.ToSummary).ToArray();

    private BoardBulkResult Import(BulkEntry entry, int index, IReadOnlyList<BoardItem> existing, BoardActor actor, DateTimeOffset now)
    {
        var byKey = entry.ExternalKey is null ? null : existing.FirstOrDefault(item => item.ExternalKey == entry.ExternalKey);
        var byId = entry.Input.Id is { } id ? existing.FirstOrDefault(item => item.Id == id) : null;
        if (byKey is null && byId is not null)
        {
            if (entry.ExternalKey is not null)
            {
                throw new DomainValidationException($"items[{index}].id", "The id belongs to an item with another external key.");
            }

            return new BoardBulkResult(index, byId.Id, byId.ExternalKey, BulkOutcomes.Unchanged);
        }

        if (byKey is null)
        {
            var (item, created) = BoardItem.Create(entry.Input.Id ?? Guid.NewGuid(), entry.Content, entry.ExternalKey, actor, now);
            item.MarkImported();
            board.AddItem(item);
            board.AddEvent(created);
            return new BoardBulkResult(index, item.Id, item.ExternalKey, BulkOutcomes.Created);
        }

        if (!Access.AllowsTopic(byKey.TopicKey))
        {
            throw new BoardTopicNotAllowedException(byKey.TopicKey);
        }

        return new BoardBulkResult(index, byKey.Id, byKey.ExternalKey, Reimport(byKey, entry.Content, actor, now));
    }

    private string Reimport(BoardItem item, BoardItemContent content, BoardActor actor, DateTimeOffset now)
    {
        if (item.IsDeleted)
        {
            return BulkOutcomes.Deleted;
        }

        if (!item.IsUntouchedSinceImport)
        {
            return BulkOutcomes.Kept;
        }

        if (item.Edit(content, actor, now) is not { } entry)
        {
            return BulkOutcomes.Unchanged;
        }

        board.AddEvent(entry);
        item.MarkImported();
        return BulkOutcomes.Updated;
    }

    private static IReadOnlyList<BulkEntry> ReadBulk(JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object || body.EnumerateObject().Any(property => !string.Equals(property.Name, "items", StringComparison.OrdinalIgnoreCase))
            || !body.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
        {
            throw new DomainValidationException("items", "The body must be {\"items\": [...]} and nothing else.");
        }

        var count = items.GetArrayLength();
        if (count is < 1 or > MaxBulkItems)
        {
            throw new DomainValidationException("items", $"A bulk import has 1-{MaxBulkItems} items.");
        }

        var entries = items.EnumerateArray().Select((element, index) =>
        {
            var input = BoardItemInput.ForCreate(element, $"items[{index}].");
            return new BulkEntry(input, input.ToNewContent(), input.ValidExternalKey());
        }).ToArray();
        EnsureDistinct(entries.Select(entry => entry.ExternalKey), "externalKey");
        EnsureDistinct(entries.Select(entry => entry.Input.Id?.ToString()), "id");
        return entries;
    }

    private static void EnsureDistinct(IEnumerable<string?> values, string field)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var value in values)
        {
            if (value is not null && !seen.Add(value))
            {
                throw new DomainValidationException($"items[{index}].{field}", $"The {field} is given twice in this import.");
            }

            index++;
        }
    }

    private async Task<BoardItem> FindInTopicAsync(Guid id, CancellationToken cancellationToken)
    {
        var item = await board.FindItemAsync(id, cancellationToken);
        return item is not null && Access.AllowsTopic(item.TopicKey) ? item : throw new BoardItemNotFoundException(id);
    }

    private async Task<BoardItem> FindWritableAsync(Guid id, CancellationToken cancellationToken)
    {
        var item = await FindInTopicAsync(id, cancellationToken);
        return item.IsDeleted ? throw new BoardItemDeletedException(id) : item;
    }

    private BoardItem Visible(BoardItem item) =>
        (item.IsDeleted && !Access.CanAdmin) || !Access.AllowsTopic(item.TopicKey) ? throw new BoardItemNotFoundException(item.Id) : item;

    private async Task EnsureWritableTopicAsync(string topicKey, CancellationToken cancellationToken)
    {
        if (!Access.AllowsTopic(topicKey))
        {
            throw new BoardTopicNotAllowedException(topicKey);
        }

        var topic = await board.FindTopicAsync(topicKey, cancellationToken) ?? throw new BoardUnknownTopicException(topicKey);
        if (topic.Archived)
        {
            throw new BoardTopicArchivedException(topicKey);
        }
    }

    private void EnsureAdmin(string what)
    {
        if (!Access.CanAdmin)
        {
            throw new BoardAdminRequiredException(what);
        }
    }

    /// <summary>The requested topics the caller may read: all she may when none were asked for (<c>null</c> = every topic).</summary>
    private IReadOnlyList<string>? VisibleTopics(IReadOnlyList<string>? requested) =>
        (requested, Access.AllowedTopics) switch
        {
            (null or { Count: 0 }, var allowed) => allowed,
            (var asked, null) => asked,
            (var asked, var allowed) => asked.Intersect(allowed, StringComparer.Ordinal).ToArray(),
        };

    private static IReadOnlyList<TEnum>? ParseAll<TEnum>(IReadOnlyList<string>? codes, string field)
        where TEnum : struct, Enum =>
        codes is { Count: > 0 } ? codes.Select(code => BoardCodes.Parse<TEnum>(code, field)).Distinct().ToArray() : null;

    private static IReadOnlyList<string>? Labels(IReadOnlyList<string>? labels)
    {
        if (labels is not { Count: > 0 })
        {
            return null;
        }

        var normalized = labels.Select(label => label.Trim().ToLowerInvariant()).Distinct(StringComparer.Ordinal).ToArray();
        return normalized.All(BoardLabels.IsValid) ? normalized : throw new DomainValidationException("label", "label must be a well-formed label.");
    }

    private static string? Search(string? q)
    {
        var trimmed = q?.Trim();
        return trimmed switch
        {
            null or { Length: 0 } => null,
            { Length: > MaxSearchLength } => throw new DomainValidationException("q", $"q must be at most {MaxSearchLength} characters."),
            _ when trimmed.Contains('\0', StringComparison.Ordinal) => throw new DomainValidationException("q", "q must not contain NUL characters."),
            _ => trimmed,
        };
    }

    private sealed record BulkEntry(BoardItemInput Input, BoardItemContent Content, string? ExternalKey);

    private static class BulkOutcomes
    {
        public const string Created = "created";
        public const string Updated = "updated";
        public const string Unchanged = "unchanged";
        public const string Kept = "kept";
        public const string Deleted = "deleted";
    }
}
