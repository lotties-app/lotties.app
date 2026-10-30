using System.Text.Json.Serialization;
using Lotties.Domain.Board;

namespace Lotties.Application.Board;

/// <summary><c>GET /board/me</c>: who the caller is and what she may do (docs/design/36-project-board.md section 3).</summary>
public sealed record BoardMeResponse(
    string Kind,
    string Name,
    IReadOnlyList<string> Roles,
    string? Scope,
    Guid? KeyId,
    bool CanRead,
    bool CanWrite,
    bool CanAdmin,
    IReadOnlyList<string>? AllowedTopics);

/// <summary>A board topic.</summary>
public sealed record BoardTopicResponse(string Key, string Name, string? Description, int SortOrder, bool Archived)
{
    public static explicit operator BoardTopicResponse(BoardTopic topic)
    {
        ArgumentNullException.ThrowIfNull(topic);
        return new BoardTopicResponse(topic.Key, topic.Name, topic.Description, topic.SortOrder, topic.Archived);
    }
}

/// <summary>Body of <c>PUT /board/topics/{key}</c> (admin): the full editable state.</summary>
public sealed record UpsertBoardTopicRequest
{
    public string? Name { get; init; }

    public string? Description { get; init; }

    public int? SortOrder { get; init; }

    public bool? Archived { get; init; }
}

/// <summary>The filters, sort and page of <c>GET /board/items</c> (section 3.2); lists are "any of".</summary>
public sealed record BoardItemListRequest
{
    public IReadOnlyList<string>? Topics { get; init; }

    public IReadOnlyList<string>? Types { get; init; }

    public IReadOnlyList<string>? Statuses { get; init; }

    public IReadOnlyList<string>? Sides { get; init; }

    public IReadOnlyList<string>? Priorities { get; init; }

    public IReadOnlyList<string>? Labels { get; init; }

    public bool? Pinned { get; init; }

    public bool? Open { get; init; }

    public string? Q { get; init; }

    public DateTimeOffset? UpdatedSince { get; init; }

    /// <summary>Only items due on or before this date (<c>yyyy-MM-dd</c>).</summary>
    public string? DueBefore { get; init; }

    /// <summary>Only items due on or after this date (<c>yyyy-MM-dd</c>).</summary>
    public string? DueAfter { get; init; }

    /// <summary><c>true</c>: only items with a due date; <c>false</c>: only items without one.</summary>
    public bool? HasDue { get; init; }

    public bool IncludeDeleted { get; init; }

    public string? Sort { get; init; }

    public int? Limit { get; init; }

    public string? Cursor { get; init; }
}

/// <summary>Who wrote: a user (never her id) or an API key (its id).</summary>
public sealed record BoardActorResponse(string Kind, string Name, Guid? KeyId);

public sealed record BoardLinkResponse(string Label, string Url);

public sealed record BoardDecisionResponse(string? Summary, string? Rationale, DateTimeOffset? DecidedAt);

/// <summary>A board item as stored (section 3.1); <see cref="Version"/> is also the <c>ETag</c>.</summary>
public sealed record BoardItemResponse
{
    public Guid Id { get; init; }

    public required string Type { get; init; }

    public required string Topic { get; init; }

    public required string Title { get; init; }

    public string? Body { get; init; }

    public required string Status { get; init; }

    public required string Side { get; init; }

    public required string Priority { get; init; }

    public required IReadOnlyList<string> Labels { get; init; }

    public DateOnly? DueDate { get; init; }

    public required IReadOnlyList<BoardLinkResponse> Links { get; init; }

    public bool Pinned { get; init; }

    /// <summary>The decision (decision items that have one), else <c>null</c>: written even where nulls are left out (MCP), never <c>{}</c>.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.Never)]
    public BoardDecisionResponse? Decision { get; init; }

    public string? Source { get; init; }

    public string? ExternalKey { get; init; }

    public required BoardActorResponse CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset UpdatedAt { get; init; }

    public DateTimeOffset? ClosedAt { get; init; }

    public DateTimeOffset? DeletedAt { get; init; }

    public int Version { get; init; }
}

/// <summary>A board item in a list: everything but the body, with its first characters as <see cref="Excerpt"/>.</summary>
public sealed record BoardItemSummaryResponse
{
    public const int ExcerptLength = 200;

    public Guid Id { get; init; }

    public required string Type { get; init; }

    public required string Topic { get; init; }

    public required string Title { get; init; }

    public string? Excerpt { get; init; }

    public required string Status { get; init; }

    public required string Side { get; init; }

    public required string Priority { get; init; }

    public required IReadOnlyList<string> Labels { get; init; }

    public DateOnly? DueDate { get; init; }

    public required IReadOnlyList<BoardLinkResponse> Links { get; init; }

    public bool Pinned { get; init; }

    /// <summary>The decision (decision items that have one), else <c>null</c>: written even where nulls are left out (MCP), never <c>{}</c>.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.Never)]
    public BoardDecisionResponse? Decision { get; init; }

    public string? Source { get; init; }

    public string? ExternalKey { get; init; }

    public required BoardActorResponse CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset UpdatedAt { get; init; }

    public DateTimeOffset? ClosedAt { get; init; }

    public DateTimeOffset? DeletedAt { get; init; }

    public int Version { get; init; }
}

/// <summary>One changed field of a history entry.</summary>
public sealed record BoardFieldChangeResponse(string Field, string? From, string? To);

/// <summary>A history entry of a board item.</summary>
public sealed record BoardItemEventResponse(
    Guid Id,
    DateTimeOffset At,
    string Kind,
    BoardActorResponse Actor,
    IReadOnlyList<BoardFieldChangeResponse> Changes,
    string? Comment)
{
    public static explicit operator BoardItemEventResponse(BoardItemEvent entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return new BoardItemEventResponse(
            entry.Id,
            entry.At,
            BoardCodes.ToCode(entry.Kind),
            new BoardActorResponse(BoardCodes.ToCode(entry.ActorKind), entry.ActorName, entry.ActorKeyId),
            entry.Changes.Select(change => new BoardFieldChangeResponse(change.Field, change.From, change.To)).ToArray(),
            entry.Comment);
    }
}

/// <summary><c>GET /board/items/{id}</c>: the item and its history, oldest first.</summary>
public sealed record BoardItemDetailResponse(BoardItemResponse Item, IReadOnlyList<BoardItemEventResponse> History);

/// <summary>A page of <c>GET /board/items</c>; <see cref="NextCursor"/> is <c>null</c> on the last page.</summary>
public sealed record BoardItemPageResponse(IReadOnlyList<BoardItemSummaryResponse> Items, string? NextCursor);

/// <summary>Body of <c>POST /board/items/{id}/comments</c>.</summary>
public sealed record BoardCommentRequest
{
    public string? Comment { get; init; }
}

/// <summary>The outcome of one entry of a bulk import (section 3.4).</summary>
public sealed record BoardBulkResult(int Index, Guid Id, string? ExternalKey, string Outcome);

public sealed record BoardBulkResponse(IReadOnlyList<BoardBulkResult> Results);

/// <summary>The number of (not deleted) items of one topic, side and status.</summary>
public sealed record BoardCountResponse(string Topic, string Side, string Status, int Count);

/// <summary>
/// The summary's totals (section 3.3). <see cref="WaitingOnOwner"/> and <see cref="WaitingOnAssistant"/> keep their first
/// meaning (open, blocked included, by side); <see cref="ActionableOwner"/> and <see cref="ActionableAssistant"/> count what
/// the summary's lists of the same names hold (open, in progress or waiting; never blocked).
/// </summary>
public sealed record BoardTotalsResponse(
    int Open,
    int WaitingOnOwner,
    int WaitingOnAssistant,
    int Blocked,
    int Overdue,
    int ActionableOwner,
    int ActionableAssistant,
    int DueSoon)
{
    /// <summary>"Due soon": not done or dropped, due from today (UTC) through this many days ahead.</summary>
    public const int DueSoonDays = 7;
}

/// <summary><c>GET /board/summary</c> (section 3.3).</summary>
public sealed record BoardSummaryResponse(
    DateTimeOffset GeneratedAt,
    BoardTotalsResponse Totals,
    IReadOnlyList<BoardCountResponse> Counts,
    IReadOnlyList<BoardItemSummaryResponse> WaitingOnOwner,
    IReadOnlyList<BoardItemSummaryResponse> WaitingOnAssistant,
    IReadOnlyList<BoardItemSummaryResponse> RecentDecisions,
    IReadOnlyList<BoardItemSummaryResponse> RecentlyUpdated,
    IReadOnlyList<BoardItemSummaryResponse> Blocked,
    IReadOnlyList<BoardItemSummaryResponse> DueSoon,
    IReadOnlyList<BoardItemSummaryResponse> Overdue);

/// <summary>A status change with an optional note, saved as one write (<c>board_set_status</c>).</summary>
public sealed record BoardStatusChangeResponse(BoardItemResponse Item, BoardItemEventResponse? Comment);

/// <summary>A recorded decision and the item it settles, saved as one write (<c>board_record_decision</c>).</summary>
public sealed record BoardDecisionRecordedResponse(BoardItemResponse Item, Guid? RelatedItemId);

/// <summary>An item of the export: the item and its history.</summary>
public sealed record BoardExportItem(BoardItemResponse Item, IReadOnlyList<BoardItemEventResponse> History);

/// <summary><c>GET /board/export</c>: the whole board the caller may read, as JSON (never API keys).</summary>
public sealed record BoardExportResponse(string Format, int Version, DateTimeOffset ExportedAt, IReadOnlyList<BoardTopicResponse> Topics, IReadOnlyList<BoardExportItem> Items)
{
    public const string FormatName = "lotties-board";
    public const int CurrentVersion = 1;
}

/// <summary>Body of <c>POST /board/keys</c> (admin).</summary>
public sealed record CreateBoardApiKeyRequest
{
    public string? Name { get; init; }

    public string? Scope { get; init; }

    public IReadOnlyList<string?>? AllowedTopics { get; init; }

    public DateTimeOffset? ExpiresAt { get; init; }
}

/// <summary>A board API key as listed (never its secret or hash).</summary>
public sealed record BoardApiKeyResponse(
    Guid Id,
    string Name,
    string Prefix,
    string Scope,
    IReadOnlyList<string>? AllowedTopics,
    string CreatedBy,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset? LastUsedAt,
    long UseCount,
    DateTimeOffset? RevokedAt,
    bool Active);

/// <summary>The answer of <c>POST /board/keys</c>: the key and its secret, shown this one time only.</summary>
public sealed record CreatedBoardApiKeyResponse(BoardApiKeyResponse Key, string Secret);
