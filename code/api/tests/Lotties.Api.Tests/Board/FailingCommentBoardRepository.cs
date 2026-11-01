using Lotties.Domain.Board;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Board;

/// <summary>
/// The real board repository, except that a save which would store a comment fails (as a lost connection would): a write
/// that saved its first part before its comment would leave that part behind, an atomic one leaves nothing.
/// </summary>
internal sealed class FailingCommentBoardRepository(IBoardRepository inner) : IBoardRepository
{
    private bool _commentPending;

    /// <summary>Replaces the registered <see cref="IBoardRepository"/> with this decorator around it.</summary>
    public static void Install(IServiceCollection services)
    {
        var registered = services.Single(service => service.ServiceType == typeof(IBoardRepository));
        services.Remove(registered);
        services.AddScoped<IBoardRepository>(provider =>
            new FailingCommentBoardRepository((IBoardRepository)ActivatorUtilities.CreateInstance(provider, registered.ImplementationType!)));
    }

    public Task<IReadOnlyList<BoardTopic>> ListTopicsAsync(CancellationToken cancellationToken = default) => inner.ListTopicsAsync(cancellationToken);

    public Task<BoardTopic?> FindTopicAsync(string key, CancellationToken cancellationToken = default) => inner.FindTopicAsync(key, cancellationToken);

    public void AddTopic(BoardTopic topic) => inner.AddTopic(topic);

    public Task<BoardItem?> FindItemAsync(Guid id, CancellationToken cancellationToken = default) => inner.FindItemAsync(id, cancellationToken);

    public Task<IReadOnlyList<BoardItem>> FindItemsAsync(IReadOnlyCollection<Guid> ids, IReadOnlyCollection<string> externalKeys, CancellationToken cancellationToken = default) =>
        inner.FindItemsAsync(ids, externalKeys, cancellationToken);

    public Task<IReadOnlyList<BoardItem>> QueryItemsAsync(BoardItemQuery query, CancellationToken cancellationToken = default) => inner.QueryItemsAsync(query, cancellationToken);

    public Task<int> CountItemsAsync(BoardItemQuery query, CancellationToken cancellationToken = default) => inner.CountItemsAsync(query, cancellationToken);

    public Task<IReadOnlyList<BoardItemCount>> CountByTopicSideStatusAsync(IReadOnlyList<string>? topics, CancellationToken cancellationToken = default) =>
        inner.CountByTopicSideStatusAsync(topics, cancellationToken);

    public Task<IReadOnlyList<BoardItemEvent>> HistoryAsync(Guid itemId, CancellationToken cancellationToken = default) => inner.HistoryAsync(itemId, cancellationToken);

    public Task<IReadOnlyList<BoardItemEvent>> HistoryOfAsync(BoardItemQuery query, CancellationToken cancellationToken = default) => inner.HistoryOfAsync(query, cancellationToken);

    public void AddItem(BoardItem item) => inner.AddItem(item);

    public void AddEvent(BoardItemEvent entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        _commentPending |= entry.Kind == BoardEventKind.Commented;
        inner.AddEvent(entry);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) =>
        _commentPending ? throw new InvalidOperationException("Simulated failure while saving a comment.") : inner.SaveChangesAsync(cancellationToken);
}
