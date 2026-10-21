using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using BabyRoutine.Domain.Medications;

namespace BabyRoutine.Domain.Imports;

/// <summary>Splits a free-text medicine comment such as <c>"Colidis e Puravit"</c> into medication names.</summary>
public static partial class MedicationTokenizer
{
    /// <summary>
    /// Splits on <c>" e "</c>, <c>" and "</c>, <c>"&amp;"</c>, <c>","</c>, <c>"+"</c>, <c>"/"</c> and line breaks
    /// (words case-insensitive), trims spaces and trailing dots, drops empty parts and keeps the first spelling of
    /// names that normalize equal (<see cref="MedicationNameMatcher.Normalize"/>).
    /// </summary>
    public static IReadOnlyList<string> Split(string? comment)
    {
        if (string.IsNullOrWhiteSpace(comment))
        {
            return [];
        }

        return Separators().Split(comment)
            .Select(part => part.Trim().TrimEnd('.').Trim())
            .Where(part => part.Length > 0)
            .DistinctBy(MedicationNameMatcher.Normalize, StringComparer.Ordinal)
            .ToArray();
    }

    [GeneratedRegex(@"\s+(?:e|and)\s+|\s*[&,+/\r\n]\s*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Separators();
}

/// <summary>A catalog medication a name was matched to; <see cref="Distance"/> 0 means equal after normalization.</summary>
public sealed record MedicationMatch(Medication Medication, int Distance);

/// <summary>
/// Matches medication names case- and diacritics-insensitively, tolerating small typos (e.g. <c>Flagas</c> /
/// <c>Flygas</c>): names up to 3 characters must be equal, up to 7 may differ by one edit, longer ones by two.
/// </summary>
public static partial class MedicationNameMatcher
{
    /// <summary>Lower case, without diacritics, with inner whitespace collapsed to one space and trimmed.</summary>
    public static string Normalize(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        var decomposed = name.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var withoutMarks = string.Concat(decomposed.Where(character => CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark));
        return Whitespace().Replace(withoutMarks, " ").Normalize(NormalizationForm.FormC);
    }

    /// <summary>The largest edit distance at which two normalized names still count as the same medication.</summary>
    public static int Tolerance(string left, string right)
    {
        var shorter = Math.Min(left.Length, right.Length);
        return shorter switch
        {
            <= 3 => 0,
            <= 7 => 1,
            _ => 2,
        };
    }

    public static bool AreSimilar(string left, string right)
    {
        var normalizedLeft = Normalize(left);
        var normalizedRight = Normalize(right);
        return Distance(normalizedLeft, normalizedRight) <= Tolerance(normalizedLeft, normalizedRight);
    }

    /// <summary>The closest catalog entry within tolerance (ties broken by name), or <c>null</c>.</summary>
    public static MedicationMatch? FindBestMatch(string name, IReadOnlyList<Medication> catalog)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        var normalized = Normalize(name);
        return catalog
            .Select(medication => MatchOrNull(normalized, medication))
            .OfType<MedicationMatch>()
            .OrderBy(match => match.Distance)
            .ThenBy(match => match.Medication.Name, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
    }

    /// <summary>Levenshtein distance (insertions, deletions and substitutions each cost one).</summary>
    public static int Distance(string left, string right)
    {
        ArgumentNullException.ThrowIfNull(left);
        ArgumentNullException.ThrowIfNull(right);
        var previous = Enumerable.Range(0, right.Length + 1).ToArray();
        for (var row = 1; row <= left.Length; row++)
        {
            previous = NextRow(previous, left[row - 1], right, row);
        }

        return previous[right.Length];
    }

    private static MedicationMatch? MatchOrNull(string normalizedName, Medication medication)
    {
        var normalizedCatalogName = Normalize(medication.Name);
        var distance = Distance(normalizedName, normalizedCatalogName);
        return distance <= Tolerance(normalizedName, normalizedCatalogName) ? new MedicationMatch(medication, distance) : null;
    }

    private static int[] NextRow(int[] previous, char leftCharacter, string right, int row)
    {
        var current = new int[previous.Length];
        current[0] = row;
        for (var column = 1; column < previous.Length; column++)
        {
            var substitution = previous[column - 1] + (leftCharacter == right[column - 1] ? 0 : 1);
            current[column] = Math.Min(Math.Min(previous[column] + 1, current[column - 1] + 1), substitution);
        }

        return current;
    }

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex Whitespace();
}
