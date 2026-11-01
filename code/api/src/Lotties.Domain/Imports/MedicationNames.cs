using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Lotties.Domain.Medications;

namespace Lotties.Domain.Imports;

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

/// <summary>
/// Bounds on the medication names of one import, so the typo matching (quadratic in the number of names) stays cheap
/// whatever the file contains.
/// </summary>
public static class MedicationNameLimits
{
    /// <summary>Most distinct (normalized) medication names one logs file may contain.</summary>
    public const int MaxDistinctNamesPerFile = 500;

    /// <summary>Longest medication name read from a comment; a medicine row with a longer name is skipped as an invalid record.</summary>
    public const int MaxNameLength = 80;
}

/// <summary>A catalog medication a name was matched to; <see cref="Distance"/> 0 means equal after normalization.</summary>
public sealed record MedicationMatch(Medication Medication, int Distance);

/// <summary>
/// Matches medication names case- and diacritics-insensitively, tolerating small typos (e.g. <c>Flagas</c> /
/// <c>Flygas</c>): names up to 3 characters must be equal, up to 7 may differ by one edit, longer ones by two.
/// </summary>
public static partial class MedicationNameMatcher
{
    /// <summary>The largest tolerance <see cref="Tolerance"/> ever returns.</summary>
    public const int MaxTolerance = 2;

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
        ArgumentNullException.ThrowIfNull(left);
        ArgumentNullException.ThrowIfNull(right);
        return Math.Min(left.Length, right.Length) switch
        {
            <= 3 => 0,
            <= 7 => 1,
            _ => MaxTolerance,
        };
    }

    public static bool AreSimilar(string left, string right) => AreSimilarNormalized(Normalize(left), Normalize(right));

    /// <summary>The closest catalog entry within tolerance (ties broken by name), or <c>null</c>.</summary>
    public static MedicationMatch? FindBestMatch(string name, IReadOnlyList<Medication> catalog)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        return MedicationCatalogIndex.Create(catalog).FindBestMatch(Normalize(name));
    }

    /// <summary>Levenshtein distance (insertions, deletions and substitutions each cost one).</summary>
    public static int Distance(string left, string right)
    {
        ArgumentNullException.ThrowIfNull(left);
        ArgumentNullException.ThrowIfNull(right);
        return BoundedDistance(left, right, Math.Max(left.Length, right.Length));
    }

    /// <summary>
    /// Levenshtein distance when it is at most <paramref name="maxDistance"/>, else <paramref name="maxDistance"/> + 1.
    /// Costs O(length x maxDistance): names whose lengths differ by more are rejected up front, only the diagonal band
    /// is computed and the computation stops as soon as a row exceeds the bound.
    /// </summary>
    public static int Distance(string left, string right, int maxDistance)
    {
        ArgumentNullException.ThrowIfNull(left);
        ArgumentNullException.ThrowIfNull(right);
        ArgumentOutOfRangeException.ThrowIfNegative(maxDistance);
        return Math.Abs(left.Length - right.Length) > maxDistance ? maxDistance + 1 : BoundedDistance(left, right, maxDistance);
    }

    /// <summary>Whether two already normalized names are within <see cref="Tolerance"/> of each other.</summary>
    internal static bool AreSimilarNormalized(string normalizedLeft, string normalizedRight) =>
        DistanceWithinTolerance(normalizedLeft, normalizedRight) is not null;

    /// <summary>The distance of two normalized names when within <see cref="Tolerance"/>, else <c>null</c>.</summary>
    internal static int? DistanceWithinTolerance(string normalizedLeft, string normalizedRight)
    {
        var tolerance = Tolerance(normalizedLeft, normalizedRight);
        var distance = Distance(normalizedLeft, normalizedRight, tolerance);
        return distance <= tolerance ? distance : null;
    }

    private static int BoundedDistance(string left, string right, int maxDistance)
    {
        var previous = InitialRow(right.Length, maxDistance);
        var current = new int[right.Length + 1];
        for (var row = 1; row <= left.Length; row++)
        {
            var smallest = FillBandedRow(previous, current, left[row - 1], right, row, maxDistance);
            if (smallest > maxDistance)
            {
                return maxDistance + 1;
            }

            (previous, current) = (current, previous);
        }

        return Math.Min(previous[right.Length], maxDistance + 1);
    }

    private static int[] InitialRow(int length, int maxDistance) =>
        Enumerable.Range(0, length + 1).Select(column => Math.Min(column, maxDistance + 1)).ToArray();

    /// <summary>Fills one row of the edit-distance matrix inside the diagonal band; cells beyond the bound hold bound + 1.</summary>
    private static int FillBandedRow(int[] previous, int[] current, char leftCharacter, string right, int row, int maxDistance)
    {
        var beyond = maxDistance + 1;
        Array.Fill(current, beyond);
        current[0] = Math.Min(row, beyond);
        var smallest = current[0];
        var last = Math.Min(right.Length, row + maxDistance);
        for (var column = Math.Max(1, row - maxDistance); column <= last; column++)
        {
            var substitution = previous[column - 1] + (leftCharacter == right[column - 1] ? 0 : 1);
            current[column] = Math.Min(Math.Min(Math.Min(previous[column] + 1, current[column - 1] + 1), substitution), beyond);
            smallest = Math.Min(smallest, current[column]);
        }

        return smallest;
    }

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex Whitespace();
}
