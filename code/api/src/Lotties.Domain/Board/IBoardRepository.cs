namespace Lotties.Domain.Board;

/// <summary>How a list of board items is ordered (every order ends with the id, so pages are stable).</summary>
public enum BoardItemSort
{
    /// <summary>Newest update first.</summary>
    Updated,

    /// <summary>Newest creation first.</summary>
    Created,

    /// <summary>Urgent first, then the earliest due date (none last), then the newest update.</summary>
    Priority,

    /// <summary>Earliest due date first, items without one last, then the newest update.</summary>
    Due,

    /// <summary>Newest decision first (the decisions log).</summary>
    Decided,
}

/// <summary>
/// A query of board items. A <c>null</c> list means "no filter"; an empty <see cref="Topics"/> matches nothing (an API
/// key limited to topics that asked for others). Deleted items only with <see cref="IncludeDeleted"/>.
/// </summary>
public sealed record BoardItemQuery
{
    public IReadOnlyList<string>? Topics { get; init; }

    public IReadOnlyList<BoardItemType>? Types { get; init; }

    public IReadOnlyList<BoardItemStatus>? Statuses { get; init; }

    public IReadOnlyList<BoardSide>? Sides { get; init; }

    public IReadOnlyList<BoardPriority>? Priorities { get; init; }

    /// <summary>Items with any of these labels.</summary>
    public IReadOnlyList<string>? Labels { get; init; }

    public bool? Pinned { get; init; }

    /// <summary><c>true</c>: not done or dropped; <c>false</c>: done or dropped.</summary>
    public bool? Open { get; init; }

    /// <summary>Case-insensitive substring of the title or the body.</summary>
    public string? Search { get; init; }

    public DateTimeOffset? UpdatedSince { get; init; }

    /// <summary>Items due strictly before this date.</summary>
    public DateOnly? DueBefore { get; init; }

    /// <summary>Items due on or after this date.</summary>
    public DateOnly? DueFrom { get; init; }

    /// <summary>Items due on or before this date.</summary>
    public DateOnly? DueUntil { get; init; }

    /// <summary><c>true</c>: only items with a due date; <c>false</c>: only items without one.</summary>
    public bool? HasDue { get; init; }

    /// <summary>Only items with a decision time.</summary>
    public bool DecidedOnly { get; init; }

    public bool IncludeDeleted { get; init; }

    public BoardItemSort Sort { get; init; } = BoardItemSort.Updated;

    public int Offset { get; init; }

    /// <summary>At most this many items (<c>null</c>: all).</summary>
    public int? Limit { get; init; }
}

/// <summary>The number of (not deleted) items of one topic, side and status.</summary>
public sealed record BoardItemCount(string TopicKey, BoardSide Side, BoardItemStatus Status, int Count);

/// <summary>Storage of the board's topics, items and their history (docs/design/36-project-board.md).</summary>
public interface IBoardRepository
{
    Task<IReadOnlyList<BoardTopic>> ListTopicsAsync(CancellationToken cancellationToken = default);

    /// <summary>The topic, tracked (an edit is saved by <see cref="SaveChangesAsync"/>).</summary>
    Task<BoardTopic?> FindTopicAsync(string key, CancellationToken cancellationToken = default);

    void AddTopic(BoardTopic topic);

    /// <summary>The item, deleted or not, tracked.</summary>
    Task<BoardItem?> FindItemAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>The items with any of the ids or external keys, deleted or not, tracked.</summary>
    Task<IReadOnlyList<BoardItem>> FindItemsAsync(IReadOnlyCollection<Guid> ids, IReadOnlyCollection<string> externalKeys, CancellationToken cancellationToken = default);

    /// <summary>The page of items the query selects, not tracked.</summary>
    Task<IReadOnlyList<BoardItem>> QueryItemsAsync(BoardItemQuery query, CancellationToken cancellationToken = default);

    /// <summary>How many items the query selects (ignoring its sort, offset and limit).</summary>
    Task<int> CountItemsAsync(BoardItemQuery query, CancellationToken cancellationToken = default);

    /// <summary>The not deleted items counted by topic, side and status (only <paramref name="topics"/> when given).</summary>
    Task<IReadOnlyList<BoardItemCount>> CountByTopicSideStatusAsync(IReadOnlyList<string>? topics, CancellationToken cancellationToken = default);

    /// <summary>The history entries of the item, oldest first.</summary>
    Task<IReadOnlyList<BoardItemEvent>> HistoryAsync(Guid itemId, CancellationToken cancellationToken = default);

    /// <summary>The history entries of every item the query selects (ignoring its sort, offset and limit), oldest first.</summary>
    Task<IReadOnlyList<BoardItemEvent>> HistoryOfAsync(BoardItemQuery query, CancellationToken cancellationToken = default);

    void AddItem(BoardItem item);

    void AddEvent(BoardItemEvent entry);

    /// <summary>Saves; a lost optimistic concurrency race is <see cref="Exceptions.ConcurrentModificationException"/>.</summary>
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}

/// <summary>Storage of board API keys.</summary>
public interface IBoardApiKeyRepository
{
    /// <summary>Every key, revoked ones included, newest first.</summary>
    Task<IReadOnlyList<BoardApiKey>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>The keys whose secret starts with <paramref name="prefix"/> (normally one), not tracked.</summary>
    Task<IReadOnlyList<BoardApiKey>> FindByPrefixAsync(string prefix, CancellationToken cancellationToken = default);

    /// <summary>The key, tracked.</summary>
    Task<BoardApiKey?> FindAsync(Guid id, CancellationToken cancellationToken = default);

    void Add(BoardApiKey key);

    /// <summary>
    /// Records a use at <paramref name="now"/> (last use time and +1 on the counter) unless one was recorded in the last
    /// <see cref="BoardApiKey.UseRecordInterval"/>: a single conditional update, so concurrent requests record one use.
    /// </summary>
    Task RecordUseAsync(Guid keyId, DateTimeOffset now, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
