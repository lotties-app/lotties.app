using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Board;

/// <summary>
/// An item of the project board (docs/design/36-project-board.md): a task, gap, decision, question, risk, note or memory
/// of one topic. Internal project management only: it never references a baby or a family. Every write returns the
/// <see cref="BoardItemEvent"/> to store with it and raises <see cref="Version"/> (the ETag, an optimistic concurrency
/// token); deleting is soft (<see cref="DeletedAt"/>).
/// </summary>
public sealed class BoardItem
{
    public const int ExternalKeyMaxLength = 120;

    private BoardItem()
    {
    }

    private BoardItem(Guid id, string? externalKey, BoardActor actor, DateTimeOffset now)
    {
        Id = id;
        ExternalKey = externalKey;
        CreatedByUserId = actor.UserId;
        CreatedByKeyId = actor.KeyId;
        CreatedByName = actor.Name;
        CreatedAt = now;
        UpdatedAt = now;
        Version = 1;
    }

    public Guid Id { get; private set; }

    public BoardItemType Type { get; private set; }

    public string TopicKey { get; private set; } = string.Empty;

    public string Title { get; private set; } = string.Empty;

    public string? Body { get; private set; }

    public BoardItemStatus Status { get; private set; }

    public BoardSide Side { get; private set; }

    public BoardPriority Priority { get; private set; }

    /// <summary>The labels in storage form (<c>,a,b,</c>, see <see cref="BoardLabels"/>); read them through <see cref="Labels"/>.</summary>
    public string LabelCodes { get; private set; } = string.Empty;

    public BoardLabels Labels => BoardLabels.FromStorage(LabelCodes);

    public DateOnly? DueDate { get; private set; }

    public BoardLinks Links { get; private set; } = BoardLinks.None;

    public bool Pinned { get; private set; }

    public DateTimeOffset? DecidedAt { get; private set; }

    public string? DecisionSummary { get; private set; }

    public string? Rationale { get; private set; }

    public string? Source { get; private set; }

    public string? ExternalKey { get; private set; }

    /// <summary>The <see cref="Version"/> right after the last bulk import wrote the item (<c>null</c> if never).</summary>
    public int? ImportedVersion { get; private set; }

    public Guid? CreatedByUserId { get; private set; }

    public Guid? CreatedByKeyId { get; private set; }

    public string CreatedByName { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset? ClosedAt { get; private set; }

    public DateTimeOffset? DeletedAt { get; private set; }

    /// <summary>1 at creation, +1 on every write; the ETag and the optimistic concurrency token.</summary>
    public int Version { get; private set; }

    public bool IsDeleted => DeletedAt is not null;

    public bool IsOpen => !BoardCodes.IsClosed(Status);

    /// <summary>Untouched since the last bulk import: re-importing may overwrite it (docs/design/36 section 3.4).</summary>
    public bool IsUntouchedSinceImport => ImportedVersion == Version;

    public BoardItemContent Content => BoardItemContent.Create(
        Type, TopicKey, Title, Body, Status, Side, Priority, Labels, DueDate, Links, Pinned, DecisionSummary, Rationale, DecidedAt, Source);

    public static (BoardItem Item, BoardItemEvent Created) Create(Guid id, BoardItemContent content, string? externalKey, BoardActor actor, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(actor);
        var at = UtcTime.Normalize(now);
        var item = new BoardItem(Ids.Required(id, nameof(id)), OptionalExternalKey(externalKey), actor, at);
        item.Apply(content.WithDecisionTime(at), at);
        return (item, BoardItemEvent.Record(item.Id, BoardEventKind.Created, actor, [], null, at));
    }

    /// <summary>The external key, trimmed (1-<see cref="ExternalKeyMaxLength"/> characters, no NUL), or <c>null</c>.</summary>
    public static string? OptionalExternalKey(string? externalKey) => Text.Optional(externalKey, "externalKey", ExternalKeyMaxLength);

    /// <summary>
    /// Replaces the editable state. Nothing changes (and <c>null</c> is returned) when <paramref name="content"/> equals the
    /// stored one. Closing sets <see cref="ClosedAt"/>, reopening clears it. The entry is <c>status_changed</c> when the
    /// status changed, else <c>decided</c> when the decision summary changed, else <c>updated</c>.
    /// </summary>
    public BoardItemEvent? Edit(BoardItemContent content, BoardActor actor, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(actor);
        EnsureNotDeleted();
        var at = UtcTime.Normalize(now);
        var before = Content;
        var after = content.WithDecisionTime(at);
        var changes = BoardFieldChange.Between(before, after);
        if (changes.Count == 0)
        {
            return null;
        }

        Apply(after, at);
        Touch(at);
        var kind = before.Status != after.Status ? BoardEventKind.StatusChanged
            : after.DecisionSummary is not null && before.DecisionSummary != after.DecisionSummary ? BoardEventKind.Decided
            : BoardEventKind.Updated;
        return BoardItemEvent.Record(Id, kind, actor, changes, null, at);
    }

    /// <summary>
    /// One write that edits and comments (<c>board_set_status</c> with a note): the comment is validated before anything
    /// changes, the version rises once, and the entries are the edit's (when something changed) then the comment (one
    /// microsecond later, so the history, ordered by time, keeps the comment after the change). No comment: <see cref="Edit"/>.
    /// </summary>
    public IReadOnlyList<BoardItemEvent> EditAndComment(BoardItemContent content, string? comment, BoardActor actor, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(actor);
        EnsureNotDeleted();
        var text = comment is null ? null : Text.Required(comment, "comment", BoardItemEvent.CommentMaxLength);
        var at = UtcTime.Normalize(now);
        var edited = Edit(content, actor, at);
        if (text is null)
        {
            return edited is null ? [] : [edited];
        }

        if (edited is null)
        {
            Touch(at);
            return [BoardItemEvent.Record(Id, BoardEventKind.Commented, actor, [], text, at)];
        }

        return [edited, BoardItemEvent.Record(Id, BoardEventKind.Commented, actor, [], text, at.AddTicks(TimeSpan.TicksPerMicrosecond))];
    }

    public BoardItemEvent Comment(string? comment, BoardActor actor, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(actor);
        EnsureNotDeleted();
        var text = Text.Required(comment, "comment", BoardItemEvent.CommentMaxLength);
        var at = UtcTime.Normalize(now);
        Touch(at);
        return BoardItemEvent.Record(Id, BoardEventKind.Commented, actor, [], text, at);
    }

    /// <summary>Soft deletes; <c>null</c> when already deleted (a repeated delete records nothing).</summary>
    public BoardItemEvent? Delete(BoardActor actor, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(actor);
        if (IsDeleted)
        {
            return null;
        }

        var at = UtcTime.Normalize(now);
        DeletedAt = at;
        Touch(at);
        return BoardItemEvent.Record(Id, BoardEventKind.Deleted, actor, [], null, at);
    }

    /// <summary>Undoes a soft delete; <c>null</c> when the item is not deleted.</summary>
    public BoardItemEvent? Restore(BoardActor actor, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(actor);
        if (!IsDeleted)
        {
            return null;
        }

        var at = UtcTime.Normalize(now);
        DeletedAt = null;
        Touch(at);
        return BoardItemEvent.Record(Id, BoardEventKind.Restored, actor, [], null, at);
    }

    /// <summary>Records that a bulk import wrote the current version (see <see cref="IsUntouchedSinceImport"/>).</summary>
    public void MarkImported() => ImportedVersion = Version;

    /// <summary>Throws <see cref="BoardVersionMismatchException"/> when <paramref name="expected"/> is given and is not <see cref="Version"/>.</summary>
    public void EnsureVersion(int? expected)
    {
        if (expected is { } version && version != Version)
        {
            throw new BoardVersionMismatchException(Id, version, Version);
        }
    }

    private void EnsureNotDeleted()
    {
        if (IsDeleted)
        {
            throw new BoardItemDeletedException(Id);
        }
    }

    private void Touch(DateTimeOffset at)
    {
        UpdatedAt = at;
        Version++;
    }

    private void Apply(BoardItemContent content, DateTimeOffset at)
    {
        var closes = BoardCodes.IsClosed(content.Status);
        ClosedAt = closes ? (BoardCodes.IsClosed(Status) && ClosedAt is not null ? ClosedAt : at) : null;
        Type = content.Type;
        TopicKey = content.TopicKey;
        Title = content.Title;
        Body = content.Body;
        Status = content.Status;
        Side = content.Side;
        Priority = content.Priority;
        LabelCodes = content.Labels.ToStorage();
        DueDate = content.DueDate;
        Links = content.Links;
        Pinned = content.Pinned;
        DecisionSummary = content.DecisionSummary;
        Rationale = content.Rationale;
        DecidedAt = content.DecidedAt;
        Source = content.Source;
    }
}
