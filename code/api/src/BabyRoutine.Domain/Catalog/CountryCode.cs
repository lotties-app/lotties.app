using System.Text.RegularExpressions;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Catalog;

/// <summary>An ISO 3166-1 alpha-2 country code in upper case (e.g. <c>BR</c>); input is trimmed and upper-cased.</summary>
public readonly partial record struct CountryCode
{
    public const int Length = 2;

    private CountryCode(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static CountryCode From(string? value)
    {
        var candidate = value?.Trim().ToUpperInvariant();
        return candidate is not null && Pattern().IsMatch(candidate)
            ? new CountryCode(candidate)
            : throw new DomainValidationException("country", "country must be a two-letter ISO 3166-1 code such as BR.");
    }

    public override string ToString() => Value;

    [GeneratedRegex(@"^[A-Z]{2}\z", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
