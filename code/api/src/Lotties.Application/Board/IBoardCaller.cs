using Lotties.Domain.Board;

namespace Lotties.Application.Board;

/// <summary>
/// What the caller of a board route may do, from her credentials (docs/design/36-project-board.md section 4): a user with
/// board realm roles, or an API key with a scope and optionally a set of topics. The policies already refused a caller
/// without read access; the services still check the finer rules (admin-only listings, a key's topics).
/// </summary>
public sealed record BoardAccess
{
    public required BoardActorKind Kind { get; init; }

    public required string Name { get; init; }

    public bool CanRead { get; init; }

    public bool CanWrite { get; init; }

    public bool CanAdmin { get; init; }

    /// <summary>The board realm roles of a user (empty for a key).</summary>
    public IReadOnlyList<string> Roles { get; init; } = [];

    /// <summary>The key's id (keys only).</summary>
    public Guid? KeyId { get; init; }

    /// <summary>The key's scope (keys only).</summary>
    public BoardKeyScope? Scope { get; init; }

    /// <summary>The only topics a key may use; <c>null</c> for every topic (always for users).</summary>
    public IReadOnlyList<string>? AllowedTopics { get; init; }

    public bool AllowsTopic(string topicKey) => AllowedTopics is not { } topics || topics.Contains(topicKey, StringComparer.Ordinal);
}

/// <summary>The caller of the current board request (the host implements it from the request's principal).</summary>
public interface IBoardCaller
{
    BoardAccess Access { get; }

    /// <summary>The actor recorded on writes: the user (her row created on first use) or the key.</summary>
    Task<BoardActor> GetActorAsync(CancellationToken cancellationToken = default);
}
