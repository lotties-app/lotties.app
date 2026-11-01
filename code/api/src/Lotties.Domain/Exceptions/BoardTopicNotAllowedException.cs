namespace Lotties.Domain.Exceptions;

/// <summary>The caller's API key is limited to other topics and cannot write to this one.</summary>
public sealed class BoardTopicNotAllowedException : DomainException
{
    public BoardTopicNotAllowedException(string topicKey)
        : base("board_topic_not_allowed", $"This API key may not write to the board topic '{topicKey}'.")
    {
        TopicKey = topicKey;
    }

    public string TopicKey { get; }
}
