using BabyRoutine.Domain.Notifications;

namespace BabyRoutine.Application.Push;

/// <summary>Where a push goes: the subscription's endpoint and its RFC 8291 encryption keys.</summary>
public sealed record PushTarget(PushEndpoint Endpoint, PushKeys Keys)
{
    public static PushTarget From(PushSubscription subscription)
    {
        ArgumentNullException.ThrowIfNull(subscription);
        return new PushTarget(subscription.Endpoint, subscription.Keys);
    }
}
