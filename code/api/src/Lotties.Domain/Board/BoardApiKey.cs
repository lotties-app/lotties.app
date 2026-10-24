using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Board;

/// <summary>
/// A board API key (docs/design/36-project-board.md section 4.2): a name, a scope, optionally a set of topics and an
/// expiry. Only the SHA-256 of the secret and its first characters are stored; the secret itself exists only in the
/// answer that created the key. Keys are never deleted: revocation is the soft delete, so the history keeps naming them.
/// Use is recorded at most once per <see cref="UseRecordInterval"/> (time and a counter; never an address).
/// </summary>
public sealed class BoardApiKey
{
    public const int NameMaxLength = 80;

    public static readonly TimeSpan UseRecordInterval = TimeSpan.FromMinutes(1);

    private BoardApiKey()
    {
    }

    private BoardApiKey(string name, BoardKeyScope scope, IReadOnlyList<string>? allowedTopics, string secret, BoardActor creator, DateTimeOffset now, DateTimeOffset? expiresAt)
    {
        Id = Guid.NewGuid();
        Name = name;
        Scope = scope;
        AllowedTopicCodes = BoardTopicKeys.SetToStorage(allowedTopics);
        Prefix = BoardKeySecret.PrefixOf(secret);
        KeyHash = BoardKeySecret.HashOf(secret);
        CreatedByUserId = creator.UserId;
        CreatedByName = creator.Name;
        CreatedAt = now;
        ExpiresAt = expiresAt;
    }

    public Guid Id { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public string Prefix { get; private set; } = string.Empty;

    public string KeyHash { get; private set; } = string.Empty;

    public BoardKeyScope Scope { get; private set; }

    /// <summary>The topics the key may use in storage form (<c>,a,b,</c>), <c>null</c> for every topic; read <see cref="AllowedTopics"/>.</summary>
    public string? AllowedTopicCodes { get; private set; }

    public IReadOnlyList<string>? AllowedTopics => BoardTopicKeys.SetFromStorage(AllowedTopicCodes);

    public Guid? CreatedByUserId { get; private set; }

    public string CreatedByName { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? ExpiresAt { get; private set; }

    public DateTimeOffset? LastUsedAt { get; private set; }

    /// <summary>The number of recorded uses (at most one per <see cref="UseRecordInterval"/>).</summary>
    public long UseCount { get; private set; }

    public DateTimeOffset? RevokedAt { get; private set; }

    /// <summary>
    /// A new key and its secret (returned once, never stored). Only a user creates keys (never a key); the expiry, when
    /// given, must be in the future.
    /// </summary>
    public static (BoardApiKey Key, string Secret) Create(string? name, BoardKeyScope scope, IReadOnlyList<string>? allowedTopics, DateTimeOffset? expiresAt, BoardActor creator, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(creator);
        if (creator.Kind != BoardActorKind.User)
        {
            throw new InvalidOperationException("Only a user creates board API keys.");
        }

        var at = UtcTime.Normalize(now);
        var expiry = UtcTime.Normalize(expiresAt);
        if (expiry is not null && expiry <= at)
        {
            throw new DomainValidationException("expiresAt", "The expiry must be in the future.");
        }

        var secret = BoardKeySecret.Generate();
        return (new BoardApiKey(Text.Required(name, "name", NameMaxLength), scope, allowedTopics, secret, creator, at, expiry), secret);
    }

    public bool IsRevoked => RevokedAt is not null;

    /// <summary>Not revoked and not expired at <paramref name="now"/>.</summary>
    public bool IsActive(DateTimeOffset now) => !IsRevoked && (ExpiresAt is null || ExpiresAt > now);

    /// <summary>Whether <paramref name="secret"/> is this key's secret (hash compared in constant time).</summary>
    public bool Matches(string secret) => BoardKeySecret.HashesEqual(BoardKeySecret.HashOf(secret), KeyHash);

    /// <summary>Whether a use at <paramref name="now"/> should be written (none recorded in the last minute).</summary>
    public bool ShouldRecordUse(DateTimeOffset now) => LastUsedAt is null || now - LastUsedAt >= UseRecordInterval;

    /// <summary>Revokes the key; returns <c>false</c> when it already was (a repeated revoke changes nothing).</summary>
    public bool Revoke(DateTimeOffset now)
    {
        if (IsRevoked)
        {
            return false;
        }

        RevokedAt = UtcTime.Normalize(now);
        return true;
    }

    /// <summary>Whether the key may use <paramref name="topicKey"/>.</summary>
    public bool AllowsTopic(string topicKey) => AllowedTopics is not { } topics || topics.Contains(topicKey, StringComparer.Ordinal);
}
