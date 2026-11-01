using System.Security.Cryptography;
using System.Text;
using Lotties.Domain.Notifications;

namespace Lotties.Application.Push;

/// <summary>
/// One Web Push message: the UTF-8 JSON payload (encrypted by the sender) and the <c>TTL</c>, <c>Urgency</c> and
/// <c>Topic</c> headers. The topic is derived from the base key so the push service replaces an undelivered earlier
/// message for the same item (a snooze re-send shares its original's topic).
/// </summary>
public sealed class PushMessage
{
    /// <summary>The longest topic push services accept.</summary>
    public const int TopicLength = 32;

    private PushMessage(string payload, string topic, TimeSpan timeToLive, NotificationUrgency urgency)
    {
        Payload = payload;
        Topic = topic;
        TimeToLive = timeToLive;
        Urgency = urgency;
    }

    public string Payload { get; }

    public string Topic { get; }

    public TimeSpan TimeToLive { get; }

    public NotificationUrgency Urgency { get; }

    public static PushMessage Create(string payload, NotificationKey key, TimeSpan timeToLive, NotificationUrgency urgency)
    {
        ArgumentException.ThrowIfNullOrEmpty(payload);
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(timeToLive, TimeSpan.Zero);
        return new PushMessage(payload, TopicOf(key), timeToLive, urgency);
    }

    /// <summary>The first <see cref="TopicLength"/> characters of base64url(SHA-256(base key)).</summary>
    public static string TopicOf(NotificationKey key)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(key.Base.Value));
        return Convert.ToBase64String(hash).Replace('+', '-').Replace('/', '_')[..TopicLength];
    }

    /// <summary>Never prints the payload (it can hold names and the action token).</summary>
    public override string ToString() => "[push message]";
}
