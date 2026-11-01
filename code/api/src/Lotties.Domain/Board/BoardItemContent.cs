using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Board;

/// <summary>
/// The editable state of a board item, validated as a whole: texts trimmed, bounded and free of NUL; <c>pinned</c> only
/// for notes and memories; the decision fields only for decisions (docs/design/36-project-board.md section 2).
/// </summary>
public sealed record BoardItemContent
{
    public const int TitleMaxLength = 200;
    public const int BodyMaxLength = 20000;
    public const int DecisionSummaryMaxLength = 1000;
    public const int RationaleMaxLength = 4000;
    public const int SourceMaxLength = 200;

    private BoardItemContent()
    {
    }

    public BoardItemType Type { get; private init; }

    public string TopicKey { get; private init; } = string.Empty;

    public string Title { get; private init; } = string.Empty;

    public string? Body { get; private init; }

    public BoardItemStatus Status { get; private init; }

    public BoardSide Side { get; private init; }

    public BoardPriority Priority { get; private init; }

    public BoardLabels Labels { get; private init; } = BoardLabels.None;

    public DateOnly? DueDate { get; private init; }

    public BoardLinks Links { get; private init; } = BoardLinks.None;

    public bool Pinned { get; private init; }

    public string? DecisionSummary { get; private init; }

    public string? Rationale { get; private init; }

    public DateTimeOffset? DecidedAt { get; private init; }

    public string? Source { get; private init; }

    public static BoardItemContent Create(
        BoardItemType type,
        string? topicKey,
        string? title,
        string? body,
        BoardItemStatus status,
        BoardSide side,
        BoardPriority priority,
        BoardLabels? labels,
        DateOnly? dueDate,
        BoardLinks? links,
        bool pinned,
        string? decisionSummary,
        string? rationale,
        DateTimeOffset? decidedAt,
        string? source)
    {
        var content = new BoardItemContent
        {
            Type = type,
            TopicKey = BoardTopicKeys.Required(topicKey),
            Title = Text.Required(title, "title", TitleMaxLength),
            Body = Text.Optional(body, "body", BodyMaxLength),
            Status = status,
            Side = side,
            Priority = priority,
            Labels = labels ?? BoardLabels.None,
            DueDate = dueDate,
            Links = links ?? BoardLinks.None,
            Pinned = pinned,
            DecisionSummary = Text.Optional(decisionSummary, "decisionSummary", DecisionSummaryMaxLength),
            Rationale = Text.Optional(rationale, "rationale", RationaleMaxLength),
            DecidedAt = UtcTime.Normalize(decidedAt),
            Source = Text.Optional(source, "source", SourceMaxLength),
        };
        content.EnsureConsistent();
        return content;
    }

    /// <summary>A decision with a summary and no time gets <paramref name="now"/> (the moment it was recorded).</summary>
    public BoardItemContent WithDecisionTime(DateTimeOffset now) =>
        Type == BoardItemType.Decision && DecisionSummary is not null && DecidedAt is null ? this with { DecidedAt = UtcTime.Normalize(now) } : this;

    private void EnsureConsistent()
    {
        if (Pinned && Type is not (BoardItemType.Note or BoardItemType.Memory))
        {
            throw new DomainValidationException("pinned", "Only notes and memories can be pinned.");
        }

        if (Type != BoardItemType.Decision && (DecisionSummary is not null || Rationale is not null || DecidedAt is not null))
        {
            var field = DecisionSummary is not null ? "decisionSummary" : Rationale is not null ? "rationale" : "decidedAt";
            throw new DomainValidationException(field, "Only decisions have a decision summary, a rationale or a decision time.");
        }
    }
}
