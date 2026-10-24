namespace Lotties.Domain.Exceptions;

/// <summary>No board topic has the key (an admin creates topics with <c>PUT /board/topics/{key}</c>).</summary>
public sealed class BoardUnknownTopicException : DomainException
{
    public BoardUnknownTopicException(string topicKey)
        : base("board_unknown_topic", $"There is no board topic '{topicKey}'.")
    {
        TopicKey = topicKey;
    }

    public string TopicKey { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["topic"] = TopicKey };
}
