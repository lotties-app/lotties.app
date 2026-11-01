namespace Lotties.Application.Push;

/// <summary>
/// Sends one encrypted, VAPID-signed Web Push message to one browser subscription (docs/design/09-push-notifications.md
/// section 8). Push-service answers never throw: they come back as a <see cref="PushSendResult"/>; only caller
/// cancellation throws.
/// </summary>
public interface IPushSender
{
    Task<PushSendResult> SendAsync(PushTarget target, PushMessage message, CancellationToken cancellationToken = default);
}
