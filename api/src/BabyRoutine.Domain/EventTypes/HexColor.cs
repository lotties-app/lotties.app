using System.Text.RegularExpressions;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.EventTypes;

/// <summary>A <c>#rrggbb</c> color, normalized to lower case.</summary>
public readonly partial record struct HexColor
{
    public const int Length = 7;

    private HexColor(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static HexColor From(string? value)
    {
        if (value is null || !Pattern().IsMatch(value))
        {
            throw new DomainValidationException("Color", "Color must be a hex value in the form #rrggbb.");
        }

        return new HexColor(value.ToLowerInvariant());
    }

    public override string ToString() => Value;

    [GeneratedRegex("^#[0-9A-Fa-f]{6}$", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
