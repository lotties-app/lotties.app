namespace Lotties.Domain.Catalog;

/// <summary>The result of comparing the structured strengths of two products with the same ingredients.</summary>
public enum StrengthComparison
{
    /// <summary>Both known, same amount and unit for every ingredient.</summary>
    Equal,

    /// <summary>Both known, same units, different amount for some ingredient.</summary>
    Different,

    /// <summary>One side has no structured strength, or the two are not comparable (other unit family, other strain).</summary>
    Unknown,
}

/// <summary>
/// The canonical strength key stored on a product (<see cref="Product.StrengthKey"/>): one <c>token</c> per active
/// ingredient, <c>{substance key}={amount} {unit}</c> (<c>simethicone=75 mg/ml</c>), sorted by substance key and joined
/// with <c>;</c>; a probiotic strain is <c>{substance key}=strain:{strain}</c>. A product without a key has no
/// structured strength (unknown): the key exists only when every ingredient's amount is unambiguous.
/// </summary>
public static class StrengthKeys
{
    public const char Separator = ';';
    public const string StrainPrefix = "strain:";

    /// <summary>The key of a single-ingredient product.</summary>
    public static string Single(string substanceKey, StrengthAmount amount)
    {
        ArgumentNullException.ThrowIfNull(amount);
        return Token(substanceKey, amount.Token);
    }

    /// <summary>The token of a strain (lower case, no separators).</summary>
    public static string StrainToken(string substanceKey, string strain) =>
        Token(substanceKey, StrainPrefix + string.Join(' ', strain.Replace(Separator, ' ').Replace('=', ' ').Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant());

    /// <summary>The key of a product from its per-ingredient tokens (sorted by substance key).</summary>
    public static string Of(IEnumerable<string> tokens)
    {
        ArgumentNullException.ThrowIfNull(tokens);
        return string.Join(Separator, tokens.Order(StringComparer.Ordinal));
    }

    /// <summary>Compares two keys; a missing key on either side is <see cref="StrengthComparison.Unknown"/>.</summary>
    public static StrengthComparison Compare(string? first, string? second)
    {
        if (string.IsNullOrEmpty(first) || string.IsNullOrEmpty(second))
        {
            return StrengthComparison.Unknown;
        }

        if (string.Equals(first, second, StringComparison.Ordinal))
        {
            return StrengthComparison.Equal;
        }

        var left = Split(first);
        var right = Split(second);
        if (left.Count != right.Count || !left.Keys.ToHashSet(StringComparer.Ordinal).SetEquals(right.Keys))
        {
            return StrengthComparison.Unknown;
        }

        var parts = left.Select(pair => ComparePart(pair.Value, right[pair.Key])).ToArray();
        return parts.Contains(StrengthComparison.Unknown)
            ? StrengthComparison.Unknown
            : parts.Contains(StrengthComparison.Different) ? StrengthComparison.Different : StrengthComparison.Equal;
    }

    private static StrengthComparison ComparePart(string first, string second)
    {
        if (string.Equals(first, second, StringComparison.Ordinal))
        {
            return StrengthComparison.Equal;
        }

        var left = Amount(first);
        var right = Amount(second);
        return left is { } a && right is { } b && string.Equals(a.Unit, b.Unit, StringComparison.Ordinal) ? StrengthComparison.Different : StrengthComparison.Unknown;
    }

    private static (string Amount, string Unit)? Amount(string value)
    {
        if (value.StartsWith(StrainPrefix, StringComparison.Ordinal))
        {
            return null;
        }

        var space = value.IndexOf(' ', StringComparison.Ordinal);
        return space <= 0 ? null : (value[..space], value[(space + 1)..]);
    }

    private static string Token(string substanceKey, string value) => $"{substanceKey}={value}";

    private static Dictionary<string, string> Split(string key) =>
        key.Split(Separator, StringSplitOptions.RemoveEmptyEntries)
            .Select(token => token.Split('=', 2))
            .Where(pair => pair.Length == 2)
            .GroupBy(pair => pair[0], StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First()[1], StringComparer.Ordinal);
}
