namespace Lotties.Domain.Exceptions;

/// <summary>The board topic is archived: it keeps its items but takes no new ones (items cannot be moved into it).</summary>
public sealed class BoardTopicArchivedException : DomainException
{
    public BoardTopicArchivedException(string topicKey)
        : base("board_topic_archived", $"The board topic '{topicKey}' is archived.")
    {
        TopicKey = topicKey;
    }

    public string TopicKey { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["topic"] = TopicKey };
}
