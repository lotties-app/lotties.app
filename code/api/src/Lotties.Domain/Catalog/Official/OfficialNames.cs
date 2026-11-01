using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Lotties.Domain.Catalog.Official;

/// <summary>A registered product name split into the display name and the dosage/presentation text the source kept in it.</summary>
public sealed record OfficialName(string DisplayName, string? Presentation);

/// <summary>
/// Display names for official records (sources write them in upper case): title case with Portuguese connectors in
/// lower case (<c>SIMETICONA + METILBROMETO DE HOMATROPINA</c> -> <c>Simeticona + Metilbrometo de Homatropina</c>), words
/// with digits kept upper case (<c>VITAMINA D3</c> -> <c>Vitamina D3</c>), and a trailing dosage (a number with a unit,
/// e.g. <c>MANITOL 20%</c>, <c>X 8,4 %</c>) moved to <see cref="OfficialName.Presentation"/>.
/// </summary>
public static partial class OfficialNames
{
    private static readonly IReadOnlySet<string> Connectors = new HashSet<string>(StringComparer.Ordinal)
    {
        "a", "à", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "no", "o", "os", "ou", "para", "por", "sem",
    };

    /// <summary>Splits and title-cases <paramref name="rawName"/>; the name keeps the whole text when nothing but a dosage would remain.</summary>
    public static OfficialName Split(string rawName)
    {
        ArgumentNullException.ThrowIfNull(rawName);
        var collapsed = Whitespace().Replace(rawName, " ").Trim();
        var dosage = TrailingDosage().Match(collapsed);
        return dosage.Success && ProductNames.Key(dosage.Groups["name"].Value).Length >= ProductNames.MinKeyLength
            ? new OfficialName(TitleCase(dosage.Groups["name"].Value), dosage.Groups["dosage"].Value.Trim())
            : new OfficialName(TitleCase(collapsed), null);
    }

    /// <summary>Title case as described on the type; whitespace collapsed.</summary>
    public static string TitleCase(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        var words = Whitespace().Replace(text, " ").Trim().Split(' ');
        return string.Join(' ', words.Select((word, index) => TitleCaseWord(word, index == 0)));
    }

    private static string TitleCaseWord(string word, bool first)
    {
        var lower = word.ToLower(CultureInfo.InvariantCulture);
        return word switch
        {
            _ when word.Any(char.IsDigit) => word.ToUpper(CultureInfo.InvariantCulture),
            _ when !first && Connectors.Contains(lower) => lower,
            _ => CapitalizeParts(lower),
        };
    }

    private static string CapitalizeParts(string lower)
    {
        var builder = new StringBuilder(lower.Length);
        foreach (var character in lower)
        {
            builder.Append(StartsPart(builder) ? char.ToUpper(character, CultureInfo.InvariantCulture) : character);
        }

        return builder.ToString();
    }

    private static bool StartsPart(StringBuilder builder) => builder.Length == 0 || !char.IsLetterOrDigit(builder[^1]);

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"^(?<name>.+?)\s+(?<dosage>\d+(?:[.,]\d+)?\s*(?:%|MG|MCG|ML|G|UI|MEQ|UNIDADES)(?:\s.*|/.*)?)$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex TrailingDosage();
}
