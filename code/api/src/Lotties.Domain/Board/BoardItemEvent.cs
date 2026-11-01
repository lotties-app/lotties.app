using Lotties.Domain.Common;

namespace Lotties.Domain.Board;

/// <summary>
/// One immutable history entry of a board item: who (<see cref="BoardActor"/> at that time), when, what kind of write and
/// which fields changed. Only account deletion touches a stored entry (<see cref="ActorUserId"/> cleared, the name replaced).
/// </summary>
public sealed class BoardItemEvent
{
    public const int CommentMaxLength = 4000;

    private BoardItemEvent()
    {
    }

    private BoardItemEvent(Guid itemId, BoardEventKind kind, BoardActor actor, IReadOnlyList<BoardFieldChange> changes, string? comment, DateTimeOffset at)
    {
        Id = Guid.NewGuid();
        ItemId = itemId;
        Kind = kind;
        ActorKind = actor.Kind;
        ActorUserId = actor.UserId;
        ActorKeyId = actor.KeyId;
        ActorName = actor.Name;
        Changes = changes;
        Comment = comment;
        At = UtcTime.Normalize(at);
    }

    public Guid Id { get; private set; }

    public Guid ItemId { get; private set; }

    public DateTimeOffset At { get; private set; }

    public BoardEventKind Kind { get; private set; }

    public BoardActorKind ActorKind { get; private set; }

    public Guid? ActorUserId { get; private set; }

    public Guid? ActorKeyId { get; private set; }

    public string ActorName { get; private set; } = string.Empty;

    public IReadOnlyList<BoardFieldChange> Changes { get; private set; } = [];

    public string? Comment { get; private set; }

    internal static BoardItemEvent Record(Guid itemId, BoardEventKind kind, BoardActor actor, IReadOnlyList<BoardFieldChange> changes, string? comment, DateTimeOffset at)
    {
        ArgumentNullException.ThrowIfNull(actor);
        return new BoardItemEvent(itemId, kind, actor, changes, comment, at);
    }
}
