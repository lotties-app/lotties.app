using System.Text.RegularExpressions;

namespace BabyRoutine.Domain.Common;

/// <summary>Lower snake_case identifiers such as event type keys and field keys.</summary>
internal static partial class Slug
{
    public const int MaxLength = 50;

    public static bool IsValid(string? value) =>
        value is { Length: > 0 and <= MaxLength } && Pattern().IsMatch(value);

    [GeneratedRegex("^[a-z][a-z0-9_]*$", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
