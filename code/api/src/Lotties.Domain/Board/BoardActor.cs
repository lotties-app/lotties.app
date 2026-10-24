using Lotties.Domain.Users;

namespace Lotties.Domain.Board;

/// <summary>
/// Who writes to the board: a user (her <see cref="User"/> row id) or an API key (its id), with the display name at that
/// time (cut to <see cref="User.DisplayNameMaxLength"/>). The only personal data the board keeps (docs/design/36 section 1).
/// </summary>
public sealed record BoardActor
{
    private BoardActor(BoardActorKind kind, Guid? userId, Guid? keyId, string name)
    {
        Kind = kind;
        UserId = userId;
        KeyId = keyId;
        Name = name;
    }

    public BoardActorKind Kind { get; }

    public Guid? UserId { get; }

    public Guid? KeyId { get; }

    public string Name { get; }

    public static BoardActor ForUser(Guid userId, string displayName) =>
        new(BoardActorKind.User, userId == Guid.Empty ? throw new ArgumentException("User id must not be empty.", nameof(userId)) : userId, null, NameOf(displayName));

    public static BoardActor ForKey(Guid keyId, string keyName) =>
        new(BoardActorKind.ApiKey, null, keyId == Guid.Empty ? throw new ArgumentException("Key id must not be empty.", nameof(keyId)) : keyId, NameOf(keyName));

    private static string NameOf(string? name)
    {
        var trimmed = string.IsNullOrWhiteSpace(name) ? "Unknown" : name.Trim().Replace("\0", string.Empty, StringComparison.Ordinal);
        return trimmed.Length > User.DisplayNameMaxLength ? trimmed[..User.DisplayNameMaxLength] : trimmed;
    }
}
