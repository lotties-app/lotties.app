namespace Lotties.Domain.Consents;

/// <summary>Persistence for <see cref="UserConsent"/> and its history.</summary>
public interface IUserConsentRepository
{
    /// <summary>The user's consent of <paramref name="kind"/>, or <c>null</c> when she never gave one; tracked.</summary>
    Task<UserConsent?> FindAsync(Guid userId, ConsentKind kind, CancellationToken cancellationToken = default);

    /// <summary>Every consent row of the user (one per kind she ever touched), untracked.</summary>
    Task<IReadOnlyList<UserConsent>> ListAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>The stored version of the user's core consent when it is in force (untracked), else <c>null</c>: all the gate reads, one primary-key lookup.</summary>
    Task<string?> CoreVersionAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>The stored versions of the in-force core consents among <paramref name="userIds"/> (users without one are absent), untracked.</summary>
    Task<IReadOnlyDictionary<Guid, string>> CoreVersionsAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default);

    /// <summary>Adds a first consent row with its first history line in one save. Returns <c>false</c>, leaving nothing tracked, when a concurrent request added the row first.</summary>
    Task<bool> TryAddAsync(UserConsent consent, UserConsentHistoryEntry entry, CancellationToken cancellationToken = default);

    /// <summary>Appends a history line (saved by the next <see cref="SaveChangesAsync"/>).</summary>
    void AddHistory(UserConsentHistoryEntry entry);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
