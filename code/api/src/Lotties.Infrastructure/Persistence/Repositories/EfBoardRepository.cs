using System.Linq.Expressions;
using Lotties.Domain.Board;
using Lotties.Domain.Exceptions;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Every filter translates the same way on PostgreSQL and on the SQLite test host: lists become <c>OR</c>ed equality
/// tests against constants (no array parameters), labels a substring test of <c>,label,</c>, the search a substring test
/// of <c>lower(title)</c> / <c>lower(body)</c> (unindexed: the board holds hundreds of rows, docs/design/36 section 3.2).
/// A lost optimistic concurrency race or a duplicate id / external key on save becomes
/// <see cref="ConcurrentModificationException"/> (retryable: a retried create then finds the stored item).
/// </remarks>
internal sealed class EfBoardRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : IBoardRepository
{
    public async Task<IReadOnlyList<BoardTopic>> ListTopicsAsync(CancellationToken cancellationToken = default) =>
        await context.BoardTopics.AsNoTracking().OrderBy(topic => topic.SortOrder).ThenBy(topic => topic.Key).ToListAsync(cancellationToken);

    public Task<BoardTopic?> FindTopicAsync(string key, CancellationToken cancellationToken = default) =>
        context.BoardTopics.SingleOrDefaultAsync(topic => topic.Key == key, cancellationToken);

    public void AddTopic(BoardTopic topic) => context.BoardTopics.Add(topic);

    public Task<BoardItem?> FindItemAsync(Guid id, CancellationToken cancellationToken = default) =>
        context.BoardItems.SingleOrDefaultAsync(item => item.Id == id, cancellationToken);

    public async Task<IReadOnlyList<BoardItem>> FindItemsAsync(IReadOnlyCollection<Guid> ids, IReadOnlyCollection<string> externalKeys, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(ids);
        ArgumentNullException.ThrowIfNull(externalKeys);
        if (ids.Count == 0 && externalKeys.Count == 0)
        {
            return [];
        }

        List<BoardItem> byId = ids.Count == 0 ? [] : await context.BoardItems.Where(AnyOf<Guid>(item => item.Id, ids)).ToListAsync(cancellationToken);
        List<BoardItem> byKey = externalKeys.Count == 0
            ? []
            : await context.BoardItems.Where(AnyOf<string?>(item => item.ExternalKey, externalKeys.Cast<string?>().ToArray())).ToListAsync(cancellationToken);
        return byId.Concat(byKey).Distinct().ToArray();
    }

    public async Task<IReadOnlyList<BoardItem>> QueryItemsAsync(BoardItemQuery query, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        var ordered = Sorted(Filtered(query), query.Sort).Skip(query.Offset);
        var page = query.Limit is { } limit ? ordered.Take(limit) : ordered;
        return await page.ToListAsync(cancellationToken);
    }

    public Task<int> CountItemsAsync(BoardItemQuery query, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        return Filtered(query).CountAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<BoardItemCount>> CountByTopicSideStatusAsync(IReadOnlyList<string>? topics, CancellationToken cancellationToken = default)
    {
        var rows = await Filtered(new BoardItemQuery { Topics = topics })
            .GroupBy(item => new { item.TopicKey, item.Side, item.Status })
            .Select(group => new { group.Key.TopicKey, group.Key.Side, group.Key.Status, Count = group.Count() })
            .ToListAsync(cancellationToken);
        return rows
            .Select(row => new BoardItemCount(row.TopicKey, row.Side, row.Status, row.Count))
            .OrderBy(row => row.TopicKey, StringComparer.Ordinal).ThenBy(row => row.Side).ThenBy(row => row.Status)
            .ToArray();
    }

    public async Task<IReadOnlyList<BoardItemEvent>> HistoryAsync(Guid itemId, CancellationToken cancellationToken = default)
    {
        var entries = await context.BoardItemEvents.AsNoTracking().Where(entry => entry.ItemId == itemId).ToListAsync(cancellationToken);
        return entries.OrderBy(entry => entry.At).ThenBy(entry => entry.Id).ToArray();
    }

    public async Task<IReadOnlyList<BoardItemEvent>> HistoryOfAsync(BoardItemQuery query, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        var ids = Filtered(query).Select(item => item.Id);
        var entries = await context.BoardItemEvents.AsNoTracking().Where(entry => ids.Contains(entry.ItemId)).ToListAsync(cancellationToken);
        return entries.OrderBy(entry => entry.At).ThenBy(entry => entry.Id).ToArray();
    }

    public void AddItem(BoardItem item) => context.BoardItems.Add(item);

    public void AddEvent(BoardItemEvent entry) => context.BoardItemEvents.Add(entry);

    public async Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new ConcurrentModificationException("board item", exception);
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            throw new ConcurrentModificationException("board item", exception);
        }
    }

    private IQueryable<BoardItem> Filtered(BoardItemQuery query)
    {
        var items = context.BoardItems.AsNoTracking();
        items = query.IncludeDeleted ? items : items.Where(item => item.DeletedAt == null);
        items = query.Topics is { } topics ? items.Where(AnyOf<string>(item => item.TopicKey, topics)) : items;
        items = query.Types is { Count: > 0 } types ? items.Where(AnyOf(item => item.Type, types)) : items;
        items = query.Statuses is { Count: > 0 } statuses ? items.Where(AnyOf(item => item.Status, statuses)) : items;
        items = query.Sides is { Count: > 0 } sides ? items.Where(AnyOf(item => item.Side, sides)) : items;
        items = query.Priorities is { Count: > 0 } priorities ? items.Where(AnyOf(item => item.Priority, priorities)) : items;
        items = query.Labels is { Count: > 0 } labels ? items.Where(WithAnyLabel(labels)) : items;
        items = query.Pinned is { } pinned ? items.Where(item => item.Pinned == pinned) : items;
        items = query.Open switch
        {
            true => items.Where(item => item.Status != BoardItemStatus.Done && item.Status != BoardItemStatus.Dropped),
            false => items.Where(item => item.Status == BoardItemStatus.Done || item.Status == BoardItemStatus.Dropped),
            null => items,
        };
        items = query.UpdatedSince is { } since ? items.Where(item => item.UpdatedAt >= since) : items;
        items = query.DueBefore is { } due ? items.Where(item => item.DueDate != null && item.DueDate < due) : items;
        items = query.DueFrom is { } from ? items.Where(item => item.DueDate != null && item.DueDate >= from) : items;
        items = query.DueUntil is { } until ? items.Where(item => item.DueDate != null && item.DueDate <= until) : items;
        items = query.HasDue switch
        {
            true => items.Where(item => item.DueDate != null),
            false => items.Where(item => item.DueDate == null),
            null => items,
        };
        items = query.DecidedOnly ? items.Where(item => item.DecidedAt != null) : items;
        return query.Search is { Length: > 0 } search ? Searched(items, search.ToLowerInvariant()) : items;
    }

    private static IQueryable<BoardItem> Searched(IQueryable<BoardItem> items, string search) =>
        items.Where(item => item.Title.ToLower().Contains(search) || (item.Body != null && item.Body.ToLower().Contains(search)));

    private static IQueryable<BoardItem> Sorted(IQueryable<BoardItem> items, BoardItemSort sort) => sort switch
    {
        BoardItemSort.Created => items.OrderByDescending(item => item.CreatedAt).ThenBy(item => item.Id),
        BoardItemSort.Priority => items
            .OrderByDescending(item => item.Priority == BoardPriority.Urgent ? 3 : item.Priority == BoardPriority.High ? 2 : item.Priority == BoardPriority.Normal ? 1 : 0)
            .ThenBy(item => item.DueDate == null ? 1 : 0)
            .ThenBy(item => item.DueDate)
            .ThenByDescending(item => item.UpdatedAt)
            .ThenBy(item => item.Id),
        BoardItemSort.Due => items
            .OrderBy(item => item.DueDate == null ? 1 : 0)
            .ThenBy(item => item.DueDate)
            .ThenByDescending(item => item.UpdatedAt)
            .ThenBy(item => item.Id),
        BoardItemSort.Decided => items.OrderByDescending(item => item.DecidedAt).ThenByDescending(item => item.UpdatedAt).ThenBy(item => item.Id),
        _ => items.OrderByDescending(item => item.UpdatedAt).ThenBy(item => item.Id),
    };

    private static Expression<Func<BoardItem, bool>> WithAnyLabel(IReadOnlyList<string> labels)
    {
        var item = Expression.Parameter(typeof(BoardItem), "item");
        var codes = Expression.Property(item, nameof(BoardItem.LabelCodes));
        var contains = typeof(string).GetMethod(nameof(string.Contains), [typeof(string)])!;
        var body = labels
            .Select(label => (Expression)Expression.Call(codes, contains, Captured(BoardLabels.StorageToken(label))))
            .Aggregate(Expression.OrElse);
        return Expression.Lambda<Func<BoardItem, bool>>(body, item);
    }

    private static Expression<Func<BoardItem, bool>> AnyOf<TValue>(Expression<Func<BoardItem, TValue>> selector, IReadOnlyCollection<TValue> values) =>
        AnyOf<BoardItem, TValue>(selector, values);

    /// <summary>
    /// <c>selector(row) == v1 || selector(row) == v2 || ...</c>; <c>false</c> for no values. Enums are compared as the C#
    /// compiler writes it (both sides converted to the underlying type, constants), which EF maps to the stored code; other
    /// values (ids, topic keys, external keys) are captured, so EF sends them as SQL parameters: the logged SQL text never
    /// carries a caller's value (docs/design/36-project-board.md section 4.3).
    /// </summary>
    private static Expression<Func<TRow, bool>> AnyOf<TRow, TValue>(Expression<Func<TRow, TValue>> selector, IReadOnlyCollection<TValue> values)
    {
        var body = values.Count == 0
            ? (Expression)Expression.Constant(false)
            : values.Select(value => Equal(selector.Body, value)).Aggregate(Expression.OrElse);
        return Expression.Lambda<Func<TRow, bool>>(body, selector.Parameters);
    }

    private static Expression Equal<TValue>(Expression column, TValue value)
    {
        if (!typeof(TValue).IsEnum)
        {
            return Expression.Equal(column, Captured(value));
        }

        var constant = Expression.Constant(value, typeof(TValue));
        var underlying = Enum.GetUnderlyingType(typeof(TValue));
        return Expression.Equal(Expression.Convert(column, underlying), Expression.Convert(constant, underlying));
    }

    /// <summary><paramref name="value"/> read from a closure, which EF turns into a SQL parameter (never a literal in the SQL text).</summary>
    private static Expression Captured<TValue>(TValue value)
    {
        Expression<Func<TValue>> read = () => value;
        return read.Body;
    }
}
