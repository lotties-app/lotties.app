using System.Text.Json;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Board;

/// <summary>What a board item is (docs/design/36-project-board.md section 2).</summary>
public enum BoardItemType
{
    Task,
    Gap,
    Decision,
    Question,
    Risk,
    Note,
    Memory,
}

/// <summary>Where a board item stands; <see cref="Done"/> and <see cref="Dropped"/> close it.</summary>
public enum BoardItemStatus
{
    Open,
    InProgress,
    Blocked,
    Waiting,
    Done,
    Dropped,
}

/// <summary>Who is expected to act next on a board item.</summary>
public enum BoardSide
{
    Owner,
    Assistant,
    Both,
    External,
}

/// <summary>How urgent a board item is (declared from the lowest to the highest).</summary>
public enum BoardPriority
{
    Low,
    Normal,
    High,
    Urgent,
}

/// <summary>What a history entry of a board item records.</summary>
public enum BoardEventKind
{
    Created,
    Updated,
    StatusChanged,
    Commented,
    Decided,
    Deleted,
    Restored,
}

/// <summary>Who wrote to the board: a signed-in user (Keycloak board role) or a board API key.</summary>
public enum BoardActorKind
{
    User,
    ApiKey,
}

/// <summary>What a board API key may do: <see cref="Write"/> implies <see cref="Read"/>; a key never administers.</summary>
public enum BoardKeyScope
{
    Read,
    Write,
}

/// <summary>
/// The wire and storage codes of the board enums: lower snake_case names (<c>in_progress</c>, <c>api_key</c>). Parsing is
/// exact (no numbers, no other casing), so a code that is stored or sent always round-trips.
/// </summary>
public static class BoardCodes
{
    public const int MaxLength = 16;

    public static string ToCode<TEnum>(TEnum value)
        where TEnum : struct, Enum =>
        JsonNamingPolicy.SnakeCaseLower.ConvertName(value.ToString());

    /// <summary>The value of <paramref name="code"/>, or a <see cref="DomainValidationException"/> naming <paramref name="field"/> and the allowed codes.</summary>
    public static TEnum Parse<TEnum>(string? code, string field)
        where TEnum : struct, Enum =>
        TryParse<TEnum>(code, out var value)
            ? value
            : throw new DomainValidationException(field, $"{field} must be one of: {string.Join(", ", AllCodes<TEnum>())}.");

    public static bool TryParse<TEnum>(string? code, out TEnum value)
        where TEnum : struct, Enum
    {
        foreach (var candidate in Enum.GetValues<TEnum>())
        {
            if (string.Equals(ToCode(candidate), code, StringComparison.Ordinal))
            {
                value = candidate;
                return true;
            }
        }

        value = default;
        return false;
    }

    public static IReadOnlyList<string> AllCodes<TEnum>()
        where TEnum : struct, Enum =>
        Enum.GetValues<TEnum>().Select(ToCode).ToArray();

    /// <summary>Whether <paramref name="status"/> closes an item (<c>done</c>, <c>dropped</c>).</summary>
    public static bool IsClosed(BoardItemStatus status) => status is BoardItemStatus.Done or BoardItemStatus.Dropped;
}
