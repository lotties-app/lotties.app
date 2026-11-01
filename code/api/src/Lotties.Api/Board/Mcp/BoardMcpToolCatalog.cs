using System.Collections.Frozen;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Lotties.Application.Board;
using Lotties.Domain.Board;
using ModelContextProtocol.Protocol;
using Kind = Lotties.Api.Board.Mcp.BoardMcpParameterKind;

namespace Lotties.Api.Board.Mcp;

/// <summary>What a board tool answers: the JSON (<c>structuredContent</c>) and one short sentence.</summary>
internal sealed record BoardMcpOutcome(JsonObject Structured, string Sentence);

/// <summary>
/// One board MCP tool: its name, whether it writes (<see cref="Writes"/>: the board write permission), its behaviour hints,
/// its parameters (schema and shape check) and the <see cref="IBoardService"/> calls it maps to: the same commands and
/// queries as the REST routes, so the rules and the history are identical (docs/design/36-project-board.md section 9).
/// <see cref="Fields"/> renames a service field in a validation error to the tool's argument (<c>comment</c> to <c>text</c>).
/// </summary>
internal sealed record BoardMcpTool(
    string Name,
    string Title,
    string Description,
    bool Writes,
    bool Destructive,
    bool Idempotent,
    IReadOnlyList<BoardMcpParameter> Parameters,
    Func<IBoardService, BoardMcpArguments, CancellationToken, Task<BoardMcpOutcome>> Run,
    IReadOnlyDictionary<string, string>? Fields = null)
{
    /// <summary>The tool as <c>tools/list</c> shows it: a strict object schema (no other members) and the behaviour hints.</summary>
    public Tool Definition() => new()
    {
        Name = Name,
        Title = Title,
        Description = Description,
        InputSchema = JsonSerializer.SerializeToElement(InputSchema()),
        Annotations = new ToolAnnotations
        {
            Title = Title,
            ReadOnlyHint = !Writes,
            DestructiveHint = Destructive,
            IdempotentHint = Idempotent,
            OpenWorldHint = false,
        },
    };

    /// <summary>The tool's argument name for a field the service named in a validation error.</summary>
    public string ArgumentOf(string field) => Fields is not null && Fields.TryGetValue(field, out var argument) ? argument : field;

    private JsonObject InputSchema()
    {
        var properties = new JsonObject();
        foreach (var parameter in Parameters)
        {
            properties[parameter.Name] = parameter.Schema();
        }

        var schema = new JsonObject { ["type"] = "object", ["properties"] = properties, ["additionalProperties"] = false };
        var required = Parameters.Where(parameter => parameter.Required).Select(parameter => (JsonNode)JsonValue.Create(parameter.Name)).ToArray();
        if (required.Length > 0)
        {
            schema["required"] = new JsonArray(required);
        }

        return schema;
    }
}

/// <summary>
/// The tools of the board's MCP endpoint (docs/design/36-project-board.md section 9): read tools need the board read
/// permission, write tools the write permission. No tool restores items, manages topics or touches API keys, and there is
/// no export tool (too large: <c>board_recent_changes</c> covers syncing). Outputs are bounded: lists at most 50 items
/// without bodies, an item's history its newest 50 entries.
/// </summary>
internal static class BoardMcpToolCatalog
{
    public const int DefaultListLimit = 20;
    public const int DefaultSearchLimit = 10;
    public const int MaxListLimit = 50;
    public const int DefaultTop = 5;
    public const int MaxTop = 20;
    public const int MaxHistory = 50;

    private const string NoBabyData = " The board is internal project tracking: never write a baby's or a family's data into it.";

    private static readonly string[] CreateFields = ["type", "topic", "title", "body", "side", "priority", "status", "labels", "dueDate", "links", "source", "pinned", "externalKey"];

    private static readonly string[] PatchFields = ["type", "topic", "title", "body", "status", "side", "priority", "labels", "dueDate", "links", "pinned", "source", "decisionSummary", "rationale"];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly BoardMcpParameter Id = new("id", Kind.Uuid, "The item's id, as the list, search and get tools return it.", Required: true);
    private static readonly BoardMcpParameter Topic = new("topic", Kind.Text, "A topic key, as board_list_topics returns it (e.g. product).", Max: BoardTopicKeys.MaxLength);
    private static readonly BoardMcpParameter RequiredTopic = Topic with { Required = true, Description = "The topic key, as board_list_topics returns it (e.g. product)." };
    private static readonly BoardMcpParameter Type = new("type", Kind.Choice, "The item type.", Values: BoardCodes.AllCodes<BoardItemType>());
    private static readonly BoardMcpParameter Status = new("status", Kind.Choice, "The status: done and dropped close the item.", Values: BoardCodes.AllCodes<BoardItemStatus>());
    private static readonly BoardMcpParameter Side = new("side", Kind.Choice, "Who acts next: owner, assistant, both or external.", Values: BoardCodes.AllCodes<BoardSide>());
    private static readonly BoardMcpParameter Priority = new("priority", Kind.Choice, "The priority (normal by default).", Values: BoardCodes.AllCodes<BoardPriority>());
    private static readonly BoardMcpParameter Title = new("title", Kind.Text, "A short title (plain text).", Required: true, Max: BoardItemContent.TitleMaxLength);
    private static readonly BoardMcpParameter Body = new("body", Kind.Text, "The details, in Markdown.", Max: BoardItemContent.BodyMaxLength);
    private static readonly BoardMcpParameter Labels = new("labels", Kind.TextList, $"Up to {BoardLabels.MaxCount} labels of lower-case a-z, 0-9, '.', '_', ':', '/', '-' (e.g. backend, review:r12).", Max: BoardLabels.MaxCount);
    private static readonly BoardMcpParameter DueDate = new("dueDate", Kind.Date, "The due date, YYYY-MM-DD.");
    private static readonly BoardMcpParameter Links = new("links", Kind.Links, "Up to 10 links, each {label, url} with an absolute http(s) URL (files of the repository, pull requests, documents).", Max: BoardLinks.MaxCount);
    private static readonly BoardMcpParameter Source = new("source", Kind.Text, "Where it came from, e.g. docs/design/34 O3 or conversation 2026-10-24.", Max: BoardItemContent.SourceMaxLength);
    private static readonly BoardMcpParameter Pinned = new("pinned", Kind.Boolean, "Pin it (notes and memories only).");
    private static readonly BoardMcpParameter DecisionSummary = new("decisionSummary", Kind.Text, "What was decided (decisions only).", Max: BoardItemContent.DecisionSummaryMaxLength);
    private static readonly BoardMcpParameter Rationale = new("rationale", Kind.Text, "Why it was decided (decisions only).", Max: BoardItemContent.RationaleMaxLength);
    private static readonly BoardMcpParameter Cursor = new("cursor", Kind.Text, "The nextCursor of the previous page, to read the next one (with the same filters).", Max: 200);

    private const string AnyOf = " One value, an array, or a comma-separated string; an item matches any of them.";

    /// <summary>The list filters of the read tools: each takes one value, an array of values, or a comma-separated string.</summary>
    private static readonly BoardMcpParameter[] Filters =
    [
        new("topic", Kind.TextFilter, "Only items of these topic keys (board_list_topics)." + AnyOf, Max: BoardTopicKeys.MaxLength, Values: ["product", "design-ux"]),
        new("type", Kind.ChoiceFilter, "Only items of these types." + AnyOf, Max: BoardCodes.AllCodes<BoardItemType>().Count, Values: BoardCodes.AllCodes<BoardItemType>()),
        new("status", Kind.ChoiceFilter, "Only items with these statuses (done and dropped are closed)." + AnyOf, Max: BoardCodes.AllCodes<BoardItemStatus>().Count, Values: BoardCodes.AllCodes<BoardItemStatus>()),
        new("side", Kind.ChoiceFilter, "Only items where one of these sides acts next." + AnyOf, Max: BoardCodes.AllCodes<BoardSide>().Count, Values: BoardCodes.AllCodes<BoardSide>()),
        new("priority", Kind.ChoiceFilter, "Only items of these priorities." + AnyOf, Max: BoardCodes.AllCodes<BoardPriority>().Count, Values: BoardCodes.AllCodes<BoardPriority>()),
        new("label", Kind.TextFilter, "Only items with one of these labels." + AnyOf, Max: BoardLabels.MaxLength, Values: ["backend", "review:r12"]),
    ];

    private static BoardMcpParameter Limit(int fallback) =>
        new("limit", Kind.Integer, $"How many items to return (1-{MaxListLimit}, {fallback} by default).", Min: 1, Max: MaxListLimit);

    public static IReadOnlyList<BoardMcpTool> All { get; } =
    [
        Read(
            "board_summary",
            "Board summary",
            "The state of the project board. Start here. totals: open (not done or dropped), waitingOnOwner / waitingOnAssistant (open by side, blocked included), actionableOwner / actionableAssistant (status open, in_progress or waiting, side owner/assistant or both: what that side should act on now), blocked, overdue, dueSoon (due today through the next 7 days). Lists (without bodies): waitingOnOwner and waitingOnAssistant hold the actionable items (never blocked, done or dropped; side both appears in both), blocked, dueSoon and overdue (earliest due first), recentDecisions, recentlyUpdated; counts by topic, side and status.",
            [new("top", Kind.Integer, $"How many items in each list (1-{MaxTop}, {DefaultTop} by default).", Min: 1, Max: MaxTop)],
            SummaryAsync),
        Read(
            "board_list_topics",
            "List topics",
            "The board's topics (key, name, description), in display order. Every item belongs to one; use the key as topic in the other tools.",
            [new("includeArchived", Kind.Boolean, "Also list archived topics (no new items go into them).")],
            ListTopicsAsync),
        Read(
            "board_list_items",
            "List items",
            "Board items matching every given filter (each filter is optional), newest update first by default, without bodies (excerpt: the body's first 200 characters; use board_get_item for the whole item). The topic, type, status, side, priority and label filters each take one value (status: \"open\"), an array (status: [\"open\", \"blocked\"]) or a comma-separated string (status: \"open,blocked\"). Due dates: dueBefore / dueAfter (inclusive, YYYY-MM-DD), hasDue, sort due. Page with cursor.",
            [
                .. Filters,
                new("pinned", Kind.Boolean, "Only pinned (true) or unpinned (false) items."),
                new("open", Kind.Boolean, "Only open items (true: status not done or dropped) or closed ones (false)."),
                new("q", Kind.Text, "Text the title or the body contains (case-insensitive).", Max: 200),
                new("updatedSince", Kind.Instant, "Only items updated at or after this instant."),
                new("dueBefore", Kind.Date, "Only items due on or before this date, YYYY-MM-DD (items without a due date are left out)."),
                new("dueAfter", Kind.Date, "Only items due on or after this date, YYYY-MM-DD (items without a due date are left out)."),
                new("hasDue", Kind.Boolean, "Only items with a due date (true) or without one (false)."),
                new("sort", Kind.Choice, "updated (newest first, the default), created, priority (urgent first, then due date), due (earliest due date first, none last) or decided (newest decision first).", Values: BoardCodes.AllCodes<BoardItemSort>()),
                Limit(DefaultListLimit),
                Cursor,
            ],
            ListItemsAsync),
        Read(
            "board_get_item",
            "Get item",
            $"One item with its body, its version (pass it to board_update_item) and its history (who changed what and when, comments), oldest first; at most the newest {MaxHistory} history entries (historyTotal counts them all).",
            [Id],
            GetItemAsync),
        Read(
            "board_search",
            "Search items",
            "Items whose title or body contains q (case-insensitive), newest update first, without bodies. The optional filters (topic, type, status, side, priority, label) each take one value, an array or a comma-separated string.",
            [
                new("q", Kind.Text, "The text to look for (1-200 characters).", Required: true, Max: 200),
                .. Filters,
                Limit(DefaultSearchLimit),
            ],
            SearchAsync),
        Read(
            "board_recent_changes",
            "Recent changes",
            "Items created or changed at or after since (any field, a status, a comment), newest first, without bodies; page with cursor. Use it to catch up instead of reading the whole board. The optional filters (topic, type, status, side, priority, label) each take one value, an array or a comma-separated string.",
            [new("since", Kind.Instant, "The instant to look from, e.g. 2026-10-24T00:00:00Z.", Required: true), .. Filters, Limit(DefaultListLimit), Cursor],
            RecentChangesAsync),
        Write(
            "board_create_item",
            "Create item",
            "Creates a task, gap, decision, question, risk, note or memory in a topic. Pass externalKey (a stable key of your own, e.g. plan:T12) to make retries safe: a call with an externalKey that exists returns the stored item unchanged (created: false). Use board_record_decision for decisions.",
            [
                Type with { Required = true },
                RequiredTopic,
                Title,
                Body,
                Side with { Required = true },
                Priority,
                Status with { Description = "The status (open by default)." },
                Labels,
                DueDate,
                Links,
                Source,
                Pinned,
                new("externalKey", Kind.Text, "Your stable key for this item (1-120 characters), for idempotent retries.", Max: BoardItem.ExternalKeyMaxLength),
            ],
            CreateItemAsync,
            destructive: false,
            idempotent: false),
        Write(
            "board_update_item",
            "Update item",
            "Changes the given fields of an item and leaves the others; null clears an optional field (body, labels, dueDate, links, source, decisionSummary, rationale). version must be the item's current version (board_get_item): when someone changed it since, nothing is saved and the answer is version_conflict with currentVersion; read it again before retrying.",
            [
                Id,
                new("version", Kind.Integer, "The item's version as you last read it.", Required: true, Min: 1, Max: int.MaxValue),
                Type,
                Topic with { Description = "Move it to this topic key." },
                Title with { Required = false },
                Body with { Nullable = true },
                Status,
                Side,
                Priority,
                Labels with { Nullable = true },
                DueDate with { Nullable = true },
                Links with { Nullable = true },
                Pinned,
                Source with { Nullable = true },
                DecisionSummary with { Nullable = true },
                Rationale with { Nullable = true },
            ],
            UpdateItemAsync,
            destructive: false,
            idempotent: true),
        Write(
            "board_set_status",
            "Set status",
            "Sets an item's status (done and dropped close it, another status reopens it) and, with note, adds the note as a comment. No version needed.",
            [Id, Status with { Required = true }, new("note", Kind.Text, "Why (added as a comment, 1-4000 characters).", Max: BoardItemEvent.CommentMaxLength)],
            SetStatusAsync,
            destructive: false,
            idempotent: false,
            fields: new Dictionary<string, string> { ["comment"] = "note" }),
        Write(
            "board_add_comment",
            "Add comment",
            "Adds a comment to an item's history.",
            [Id, new("text", Kind.Text, "The comment (1-4000 characters, Markdown).", Required: true, Max: BoardItemEvent.CommentMaxLength)],
            AddCommentAsync,
            destructive: false,
            idempotent: false,
            fields: new Dictionary<string, string> { ["comment"] = "text" }),
        Write(
            "board_record_decision",
            "Record decision",
            "Records a decision that was taken: a decision item (status done, decided now) in a topic. With relatedItemId, the decision names that item and a comment on that item points to the decision.",
            [
                RequiredTopic,
                Title,
                DecisionSummary with { Required = true },
                Rationale with { Required = true },
                Source,
                new("relatedItemId", Kind.Uuid, "The item this decision settles (a question, a gap, a task)."),
            ],
            RecordDecisionAsync,
            destructive: false,
            idempotent: false),
        Write(
            "board_delete_item",
            "Delete item",
            "Deletes an item (soft delete: it disappears from the board, its history stays, a board admin can restore it). Deleting a deleted item changes nothing.",
            [Id],
            DeleteItemAsync,
            destructive: true,
            idempotent: true),
    ];

    private static readonly FrozenDictionary<string, BoardMcpTool> ByName = All.ToFrozenDictionary(tool => tool.Name, StringComparer.Ordinal);

    public static BoardMcpTool? Find(string? name) => name is not null && ByName.TryGetValue(name, out var tool) ? tool : null;

    /// <summary>The tools <paramref name="access"/> may call, in catalog order: read tools with read, write tools with write.</summary>
    public static IReadOnlyList<BoardMcpTool> AllowedFor(BoardAccess access)
    {
        ArgumentNullException.ThrowIfNull(access);
        return All.Where(tool => tool.Writes ? access.CanWrite : access.CanRead).ToArray();
    }

    /// <summary>A result value as a JSON object (camelCase, nulls left out).</summary>
    public static JsonObject ToJson(object value) => JsonSerializer.SerializeToNode(value, Json)!.AsObject();

    private static JsonNode ToNode(object value) => JsonSerializer.SerializeToNode(value, Json)!;

    private static BoardMcpTool Read(string name, string title, string description, BoardMcpParameter[] parameters, Func<IBoardService, BoardMcpArguments, CancellationToken, Task<BoardMcpOutcome>> run) =>
        new(name, title, description, Writes: false, Destructive: false, Idempotent: true, parameters, run);

    private static BoardMcpTool Write(
        string name,
        string title,
        string description,
        BoardMcpParameter[] parameters,
        Func<IBoardService, BoardMcpArguments, CancellationToken, Task<BoardMcpOutcome>> run,
        bool destructive,
        bool idempotent,
        IReadOnlyDictionary<string, string>? fields = null) =>
        new(name, title, description + NoBabyData, Writes: true, destructive, idempotent, parameters, run, fields);

    private static async Task<BoardMcpOutcome> SummaryAsync(IBoardService board, BoardMcpArguments arguments, CancellationToken cancellationToken)
    {
        var summary = await board.SummaryAsync(arguments.Integer("top") ?? DefaultTop, cancellationToken);
        var totals = summary.Totals;
        return new(
            ToJson(summary),
            $"Board: {totals.Open} open items, {totals.WaitingOnOwner} waiting on the owner ({totals.ActionableOwner} actionable), {totals.WaitingOnAssistant} waiting on the assistant ({totals.ActionableAssistant} actionable), {totals.Blocked} blocked, {totals.Overdue} overdue, {totals.DueSoon} due in the next {BoardTotalsResponse.DueSoonDays} days.");
    }

    private static async Task<BoardMcpOutcome> ListTopicsAsync(IBoardService board, BoardMcpArguments arguments, CancellationToken cancellationToken)
    {
        var topics = await board.ListTopicsAsync(arguments.Boolean("includeArchived") ?? false, cancellationToken);
        return new(new JsonObject { ["topics"] = ToNode(topics) }, $"{Count(topics.Count, "topic")}: {string.Join(", ", topics.Select(topic => topic.Key))}.");
    }

    private static async Task<BoardMcpOutcome> ListItemsAsync(IBoardService board, BoardMcpArguments arguments, CancellationToken cancellationToken)
    {
        var page = await board.ListItemsAsync(
            new BoardItemListRequest
            {
                Topics = arguments.Filter("topic"),
                Types = arguments.Filter("type"),
                Statuses = arguments.Filter("status"),
                Sides = arguments.Filter("side"),
                Priorities = arguments.Filter("priority"),
                Labels = arguments.Filter("label"),
                Pinned = arguments.Boolean("pinned"),
                Open = arguments.Boolean("open"),
                Q = arguments.Text("q"),
                UpdatedSince = arguments.Instant("updatedSince"),
                DueBefore = arguments.Text("dueBefore"),
                DueAfter = arguments.Text("dueAfter"),
                HasDue = arguments.Boolean("hasDue"),
                Sort = arguments.Text("sort"),
                Limit = arguments.Integer("limit") ?? DefaultListLimit,
                Cursor = arguments.Text("cursor"),
            },
            cancellationToken);
        return Page(ToJson(page), page);
    }

    private static async Task<BoardMcpOutcome> GetItemAsync(IBoardService board, BoardMcpArguments arguments, CancellationToken cancellationToken)
    {
        var detail = await board.GetItemAsync(arguments.Id("id"), cancellationToken);
        var history = detail.History.Skip(Math.Max(0, detail.History.Count - MaxHistory)).ToArray();
        var item = detail.Item;
        var structured = new JsonObject
        {
            ["item"] = ToNode(item),
            ["history"] = ToNode(history),
            ["historyTotal"] = detail.History.Count,
        };
        return new(structured, $"{item.Type} \"{item.Title}\" in {item.Topic}: {item.Status}, side {item.Side}, priority {item.Priority}, version {Number(item.Version)}{(item.DeletedAt is null ? string.Empty : ", deleted")}.");
    }

    private static async Task<BoardMcpOutcome> SearchAsync(IBoardService board, BoardMcpArguments arguments, CancellationToken cancellationToken)
    {
        var page = await board.ListItemsAsync(
            new BoardItemListRequest
            {
                Q = arguments.Text("q"),
                Topics = arguments.Filter("topic"),
                Types = arguments.Filter("type"),
                Statuses = arguments.Filter("status"),
                Sides = arguments.Filter("side"),
                Priorities = arguments.Filter("priority"),
                Labels = arguments.Filter("label"),
                Limit = arguments.Integer("limit") ?? DefaultSearchLimit,
            },
            cancellationToken);
        return Page(new JsonObject { ["items"] = ToNode(page.Items) }, page with { NextCursor = null });
    }

    private static async Task<BoardMcpOutcome> RecentChangesAsync(IBoardService board, BoardMcpArguments arguments, CancellationToken cancellationToken)
    {
        var since = arguments.Instant("since")!.Value;
        var page = await board.ListItemsAsync(
            new BoardItemListRequest
            {
                UpdatedSince = since,
                Topics = arguments.Filter("topic"),
                Types = arguments.Filter("type"),
                Statuses = arguments.Filter("status"),
                Sides = arguments.Filter("side"),
                Priorities = arguments.Filter("priority"),
                Labels = arguments.Filter("label"),
                Limit = arguments.Integer("limit") ?? DefaultListLimit,
                Cursor = arguments.Text("cursor"),
            },
            cancellationToken);
        var structured = ToJson(page);
        structured["since"] = since.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
        return Page(structured, page);
    }

    private static async Task<BoardMcpOutcome> CreateItemAsync(IBoardService board, BoardMcpArguments arguments, CancellationToken cancellationToken)
    {
        var (item, created) = await board.CreateItemAsync(arguments.ObjectOf(CreateFields), cancellationToken);
        var structured = new JsonObject { ["item"] = ToNode(item), ["created"] = created };
        return new(
            structured,
            created
                ? $"Created {item.Type} {item.Id} in {item.Topic} (version {Number(item.Version)})."
                : $"An item with this externalKey already exists: {item.Id} (version {Number(item.Version)}), returned unchanged.");
    }

    private static async Task<BoardMcpOutcome> UpdateItemAsync(IBoardService board, BoardMcpArguments arguments, CancellationToken cancellationToken)
    {
        var item = await board.PatchItemAsync(arguments.Id("id"), arguments.ObjectOf(PatchFields), arguments.Integer("version"), cancellationToken);
        return new(new JsonObject { ["item"] = ToNode(item) }, $"Item {item.Id} is at version {Number(item.Version)}.");
    }

    private static async Task<BoardMcpOutcome> SetStatusAsync(IBoardService board, BoardMcpArguments arguments, CancellationToken cancellationToken)
    {
        var (item, comment) = await board.SetStatusAsync(arguments.Id("id"), arguments.Text("status"), arguments.Text("note"), cancellationToken);
        var structured = new JsonObject();
        if (comment is not null)
        {
            structured["comment"] = ToNode(comment);
        }

        structured["item"] = ToNode(item);
        return new(structured, $"Item {item.Id} is {item.Status} (version {Number(item.Version)}).");
    }

    private static async Task<BoardMcpOutcome> AddCommentAsync(IBoardService board, BoardMcpArguments arguments, CancellationToken cancellationToken)
    {
        var id = arguments.Id("id");
        var entry = await board.CommentAsync(id, new BoardCommentRequest { Comment = arguments.Text("text") }, cancellationToken);
        return new(new JsonObject { ["itemId"] = id.ToString(), ["comment"] = ToNode(entry) }, $"Comment added to item {id}.");
    }

    private static async Task<BoardMcpOutcome> RecordDecisionAsync(IBoardService board, BoardMcpArguments arguments, CancellationToken cancellationToken)
    {
        var related = arguments.OptionalId("relatedItemId");
        var extra = new Dictionary<string, JsonNode?>
        {
            ["type"] = BoardCodes.ToCode(BoardItemType.Decision),
            ["status"] = BoardCodes.ToCode(BoardItemStatus.Done),
        };
        if (related is { } settles)
        {
            extra["body"] = $"Related board item: {settles}";
        }

        // One write: the decision and the comment on the related item are saved together (nothing when either fails).
        var (item, relatedItemId) = await board.RecordDecisionAsync(arguments.ObjectOf(["topic", "title", "decisionSummary", "rationale", "source"], extra), related, cancellationToken);
        var structured = new JsonObject { ["item"] = ToNode(item) };
        if (relatedItemId is { } target)
        {
            structured["relatedItemId"] = target.ToString();
        }

        return new(structured, $"Recorded decision {item.Id} in {item.Topic}.");
    }

    private static async Task<BoardMcpOutcome> DeleteItemAsync(IBoardService board, BoardMcpArguments arguments, CancellationToken cancellationToken)
    {
        var id = arguments.Id("id");
        await board.DeleteItemAsync(id, cancellationToken);
        return new(new JsonObject { ["id"] = id.ToString(), ["deleted"] = true }, $"Item {id} is deleted (a board admin can restore it).");
    }

    private static BoardMcpOutcome Page(JsonObject structured, BoardItemPageResponse page) =>
        new(structured, $"{Count(page.Items.Count, "item")}{(page.NextCursor is null ? "." : "; more: pass nextCursor as cursor.")}");

    private static string Count(int count, string noun) => $"{Number(count)} {noun}{(count == 1 ? string.Empty : "s")}";

    private static string Number(int value) => value.ToString(CultureInfo.InvariantCulture);
}
