using System.Text.RegularExpressions;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Board;

/// <summary>
/// The labels of a board item: at most <see cref="MaxCount"/>, each 1-<see cref="MaxLength"/> characters of
/// <c>[a-z0-9._:/-]</c> starting with a letter or digit, stored lower-case, distinct, in the given order. Stored as
/// <c>,a,b,</c> (empty for none), so "has label x" is a portable substring test of <c>,x,</c>.
/// </summary>
public sealed partial record BoardLabels
{
    public const int MaxCount = 10;
    public const int MaxLength = 40;

    /// <summary>The longest storage text: ten labels of 40 characters, their separators and the two ends.</summary>
    public const int StorageMaxLength = (MaxCount * (MaxLength + 1)) + 1;

    private BoardLabels(IReadOnlyList<string> values) => Values = values;

    public static BoardLabels None { get; } = new(Array.Empty<string>());

    public IReadOnlyList<string> Values { get; }

    /// <summary>Validates and normalizes (trim, lower-case, duplicates removed); <c>null</c> is no labels.</summary>
    public static BoardLabels Create(IEnumerable<string?>? labels, string field = "labels")
    {
        if (labels is null)
        {
            return None;
        }

        var normalized = new List<string>();
        foreach (var label in labels)
        {
            var value = label?.Trim().ToLowerInvariant() ?? string.Empty;
            if (value.Length is 0 or > MaxLength || !Pattern().IsMatch(value))
            {
                throw new DomainValidationException(field, $"Each label must be 1-{MaxLength} characters of a-z, 0-9, '.', '_', ':', '/' or '-', starting with a letter or digit.");
            }

            if (!normalized.Contains(value, StringComparer.Ordinal))
            {
                normalized.Add(value);
            }
        }

        return normalized.Count > MaxCount
            ? throw new DomainValidationException(field, $"An item has at most {MaxCount} labels.")
            : new BoardLabels(normalized);
    }

    /// <summary>Whether <paramref name="label"/> is a well-formed label (used to validate filters).</summary>
    public static bool IsValid(string? label) => label is { Length: > 0 and <= MaxLength } && Pattern().IsMatch(label);

    /// <summary>The storage text of one label as a filter: <c>,label,</c>.</summary>
    public static string StorageToken(string label) => $",{label},";

    public static BoardLabels FromStorage(string? stored) =>
        string.IsNullOrEmpty(stored) ? None : new BoardLabels(stored.Split(',', StringSplitOptions.RemoveEmptyEntries));

    public string ToStorage() => Values.Count == 0 ? string.Empty : $",{string.Join(',', Values)},";

    public bool Equals(BoardLabels? other) => other is not null && Values.SequenceEqual(other.Values, StringComparer.Ordinal);

    public override int GetHashCode() => Values.Aggregate(0, (hash, value) => HashCode.Combine(hash, StringComparer.Ordinal.GetHashCode(value)));

    public override string ToString() => string.Join(", ", Values);

    [GeneratedRegex(@"^[a-z0-9][a-z0-9._:/-]*\z", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
