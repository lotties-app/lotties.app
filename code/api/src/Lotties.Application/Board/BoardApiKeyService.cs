using Lotties.Domain.Board;
using Lotties.Domain.Exceptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Board;

/// <summary>
/// Board API keys (docs/design/36-project-board.md section 4.2): created, listed and revoked by board admins (users only,
/// never a key), and authenticated for the <c>BoardKey</c> scheme. Logs carry key ids and outcomes, never a secret, a
/// hash or a prefix.
/// </summary>
public interface IBoardApiKeyService
{
    Task<IReadOnlyList<BoardApiKeyResponse>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>Creates a key; the answer holds the secret, which is never available again.</summary>
    Task<CreatedBoardApiKeyResponse> CreateAsync(CreateBoardApiKeyRequest request, CancellationToken cancellationToken = default);

    /// <summary>Revokes a key (again: nothing changes).</summary>
    Task RevokeAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// The active key whose secret is <paramref name="secret"/>, or <c>null</c> (malformed, unknown, revoked or expired);
    /// records the use at most once a minute.
    /// </summary>
    Task<BoardApiKey?> AuthenticateAsync(string secret, CancellationToken cancellationToken = default);
}

internal sealed class BoardApiKeyService(
    IBoardApiKeyRepository keys,
    IBoardRepository board,
    IBoardCaller caller,
    TimeProvider timeProvider,
    ILogger<BoardApiKeyService> logger) : IBoardApiKeyService
{
    public async Task<IReadOnlyList<BoardApiKeyResponse>> ListAsync(CancellationToken cancellationToken = default)
    {
        EnsureAdminUser();
        var now = timeProvider.GetUtcNow();
        return (await keys.ListAsync(cancellationToken)).Select(key => BoardMapping.ToResponse(key, now)).ToArray();
    }

    public async Task<CreatedBoardApiKeyResponse> CreateAsync(CreateBoardApiKeyRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureAdminUser();
        var scope = BoardCodes.Parse<BoardKeyScope>(request.Scope, "scope");
        var topics = BoardTopicKeys.OptionalSet(request.AllowedTopics, "allowedTopics");
        foreach (var topic in topics ?? [])
        {
            _ = await board.FindTopicAsync(topic, cancellationToken) ?? throw new BoardUnknownTopicException(topic);
        }

        var actor = await caller.GetActorAsync(cancellationToken);
        var now = timeProvider.GetUtcNow();
        var (key, secret) = BoardApiKey.Create(request.Name, scope, topics, request.ExpiresAt, actor, now);
        keys.Add(key);
        await keys.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Board API key {KeyId} created with scope {Scope}", key.Id, BoardCodes.ToCode(scope));
        return new CreatedBoardApiKeyResponse(BoardMapping.ToResponse(key, now), secret);
    }

    public async Task RevokeAsync(Guid id, CancellationToken cancellationToken = default)
    {
        EnsureAdminUser();
        var key = await keys.FindAsync(id, cancellationToken) ?? throw new BoardApiKeyNotFoundException(id);
        if (key.Revoke(timeProvider.GetUtcNow()))
        {
            await keys.SaveChangesAsync(cancellationToken);
            logger.LogInformation("Board API key {KeyId} revoked", id);
        }
    }

    public async Task<BoardApiKey?> AuthenticateAsync(string secret, CancellationToken cancellationToken = default)
    {
        if (!BoardKeySecret.IsWellFormed(secret))
        {
            logger.LogInformation("Board API key refused: malformed");
            return null;
        }

        var candidates = await keys.FindByPrefixAsync(BoardKeySecret.PrefixOf(secret), cancellationToken);
        var matches = candidates.Where(candidate => candidate.Matches(secret)).ToArray();
        var now = timeProvider.GetUtcNow();
        if (matches is not [var key])
        {
            logger.LogInformation("Board API key refused: unknown");
            return null;
        }

        if (!key.IsActive(now))
        {
            logger.LogInformation("Board API key {KeyId} refused: {Reason}", key.Id, key.IsRevoked ? "revoked" : "expired");
            return null;
        }

        if (key.ShouldRecordUse(now))
        {
            await keys.RecordUseAsync(key.Id, now, cancellationToken);
        }

        return key;
    }

    /// <summary>Keys are managed by admin users only: a key never has admin, and this rechecks it.</summary>
    private void EnsureAdminUser()
    {
        if (caller.Access is not { Kind: BoardActorKind.User, CanAdmin: true })
        {
            throw new BoardAdminRequiredException("manage API keys");
        }
    }
}
