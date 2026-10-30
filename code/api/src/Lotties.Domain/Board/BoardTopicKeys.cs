using System.Text.RegularExpressions;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Board;

/// <summary>
/// Topic keys (<c>privacy-legal</c>): 2-<see cref="MaxLength"/> characters of <c>[a-z0-9-]</c>, starting with a letter. A
/// set of them (the topics an API key may use) is stored as <c>,a,b,</c>.
/// </summary>
public static partial class BoardTopicKeys
{
    public const int MaxLength = 40;

    /// <summary>The most keys a stored set (an API key's topics) may hold.</summary>
    public const int MaxSetCount = 10;

    public const int SetStorageMaxLength = (MaxSetCount * (MaxLength + 1)) + 1;

    public static bool IsValid(string? key) => key is { Length: >= 2 and <= MaxLength } && Pattern().IsMatch(key);

    /// <summary>The trimmed key, or a <see cref="DomainValidationException"/> naming <paramref name="field"/>.</summary>
    public static string Required(string? key, string field = "topic")
    {
        var trimmed = key?.Trim();
        return IsValid(trimmed)
            ? trimmed!
            : throw new DomainValidationException(field, $"{field} must be a topic key: 2-{MaxLength} characters of a-z, 0-9 and '-', starting with a letter.");
    }

    /// <summary>A validated, distinct set of keys (<c>null</c> stays <c>null</c>: no limit); an empty set is invalid.</summary>
    public static IReadOnlyList<string>? OptionalSet(IEnumerable<string?>? keys, string field)
    {
        if (keys is null)
        {
            return null;
        }

        var set = keys.Select(key => Required(key, field)).Distinct(StringComparer.Ordinal).ToArray();
        return set.Length switch
        {
            0 => throw new DomainValidationException(field, $"{field} must name at least one topic, or be left out for every topic."),
            > MaxSetCount => throw new DomainValidationException(field, $"{field} names at most {MaxSetCount} topics."),
            _ => set,
        };
    }

    public static string? SetToStorage(IReadOnlyList<string>? keys) => keys is null ? null : $",{string.Join(',', keys)},";

    public static IReadOnlyList<string>? SetFromStorage(string? stored) =>
        stored is null ? null : stored.Split(',', StringSplitOptions.RemoveEmptyEntries);

    [GeneratedRegex(@"^[a-z][a-z0-9-]*\z", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
