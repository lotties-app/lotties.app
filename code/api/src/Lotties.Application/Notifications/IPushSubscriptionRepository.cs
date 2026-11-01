using Lotties.Domain.Notifications;

namespace Lotties.Application.Notifications;

/// <summary>
/// Persistence for <see cref="PushSubscription"/>. "Active" means not revoked; a past push-service expiration is checked
/// by <see cref="PushSubscription.IsActiveAt"/>. Endpoints are looked up by their hash only.
/// </summary>
public interface IPushSubscriptionRepository
{
    /// <summary>The subscription (any user, revoked or not) whose endpoint hashes to <paramref name="endpointHash"/>; tracked.</summary>
    Task<PushSubscription?> FindByEndpointHashAsync(string endpointHash, CancellationToken cancellationToken = default);

    /// <summary>The subscription <paramref name="subscriptionId"/> when it belongs to <paramref name="userId"/>, revoked or not; tracked.</summary>
    Task<PushSubscription?> FindForUserAsync(Guid userId, Guid subscriptionId, CancellationToken cancellationToken = default);

    /// <summary>The user's non-revoked subscriptions, most recently seen first; tracked (the device cap revokes some).</summary>
    Task<IReadOnlyList<PushSubscription>> ListActiveForUserAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>The non-revoked subscriptions of these users (scheduler recipients); tracked (sends record their outcome).</summary>
    Task<IReadOnlyList<PushSubscription>> ListActiveForUsersAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default);

    /// <summary>The subscriptions with these ids, revoked or not (retry pass); tracked.</summary>
    Task<IReadOnlyList<PushSubscription>> ListByIdsAsync(IReadOnlyCollection<Guid> subscriptionIds, CancellationToken cancellationToken = default);

    /// <summary>
    /// Saves a new subscription. Returns <c>false</c>, leaving nothing tracked, when the same endpoint was saved first
    /// (concurrent subscribe); the caller then refreshes the stored one.
    /// </summary>
    Task<bool> TryAddAsync(PushSubscription subscription, CancellationToken cancellationToken = default);

    /// <summary>Housekeeping: revokes as <see cref="SubscriptionRevokeReason.Inactive"/> every active subscription last seen before <paramref name="seenBefore"/>; returns how many.</summary>
    Task<int> RevokeNotSeenSinceAsync(DateTimeOffset seenBefore, DateTimeOffset now, CancellationToken cancellationToken = default);

    /// <summary>Housekeeping: revokes as <see cref="SubscriptionRevokeReason.Gone"/> every active subscription whose expiration time is at or before <paramref name="now"/>; returns how many.</summary>
    Task<int> RevokeExpiredAsync(DateTimeOffset now, CancellationToken cancellationToken = default);

    /// <summary>How many subscriptions are active at <paramref name="now"/>: not revoked and not past their expiration time (metrics).</summary>
    Task<int> CountActiveAsync(DateTimeOffset now, CancellationToken cancellationToken = default);

    /// <summary>Housekeeping: hard-deletes subscriptions revoked before <paramref name="revokedBefore"/> (their deliveries cascade); returns how many.</summary>
    Task<int> DeleteRevokedBeforeAsync(DateTimeOffset revokedBefore, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
