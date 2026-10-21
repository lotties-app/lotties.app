using System.Text;
using System.Text.RegularExpressions;
using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Imports;

namespace BabyRoutine.Domain.Catalog;

/// <summary>
/// Names of the shared catalog: sanitising what users type and the compact matching key used for dedupe and search.
/// The key reuses the importer's normalisation (<see cref="MedicationNameMatcher.Normalize"/>: lower case, no
/// diacritics) and then keeps letters and digits only and collapses repeated letters, so <c>"Fly-Gass"</c>,
/// <c>"flygas"</c> and <c>"Flýgas"</c> share the key <c>flygas</c>. Digits are never collapsed (<c>100</c> stays).
/// </summary>
public static partial class ProductNames
{
    /// <summary>Shortest key a product name or a search query must have.</summary>
    public const int MinKeyLength = 2;

    /// <summary>
    /// Trims, collapses inner whitespace to single spaces and rejects control characters (NUL included), empty names,
    /// names longer than <paramref name="maxLength"/> and names whose key is shorter than <see cref="MinKeyLength"/>.
    /// </summary>
    public static string Sanitize(string? name, string field, int maxLength)
    {
        var collapsed = Whitespace().Replace(name ?? string.Empty, " ").Trim();
        EnsureNoControlCharacters(collapsed, field);
        var required = Text.Required(collapsed, field, maxLength);
        return Key(required).Length >= MinKeyLength
            ? required
            : throw new DomainValidationException(field, $"{field} must contain at least {MinKeyLength} letters or digits.");
    }

    /// <summary>The compact matching key of <paramref name="name"/> (may be empty).</summary>
    public static string Key(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        var lettersAndDigits = MedicationNameMatcher.Normalize(name).Where(char.IsLetterOrDigit);
        return CollapseRepeatedLetters(lettersAndDigits);
    }

    private static string CollapseRepeatedLetters(IEnumerable<char> characters)
    {
        var builder = new StringBuilder();
        foreach (var character in characters)
        {
            AppendUnlessRepeatedLetter(builder, character);
        }

        return builder.ToString();
    }

    private static void AppendUnlessRepeatedLetter(StringBuilder builder, char character)
    {
        if (builder.Length > 0 && char.IsLetter(character) && builder[^1] == character)
        {
            return;
        }

        builder.Append(character);
    }

    private static void EnsureNoControlCharacters(string value, string field)
    {
        if (value.Any(char.IsControl))
        {
            throw new DomainValidationException(field, $"{field} must not contain control characters.");
        }
    }

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex Whitespace();
}
