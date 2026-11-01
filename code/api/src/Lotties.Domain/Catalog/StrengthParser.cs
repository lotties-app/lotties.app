using System.Globalization;
using System.Text.RegularExpressions;

namespace Lotties.Domain.Catalog;

/// <summary>
/// A strength in canonical units: <see cref="Amount"/> (no trailing zeros) and <see cref="Unit"/> (lower case). Mass
/// units are all milligrams (<c>mg</c>, <c>mg/ml</c>, <c>mg/g</c>, <c>mg/dose</c>...), because g, mg and mcg are exactly
/// equivalent by powers of ten; every other unit (<c>%</c>, <c>ui</c>, <c>u</c>, <c>meq</c>, <c>mmol</c>, <c>ml/ml</c>...)
/// stays as it is: no conversion between unit families is invented (0,9% is <b>not</b> turned into 9 mg/mL).
/// </summary>
public sealed record StrengthAmount(decimal Amount, string Unit)
{
    /// <summary>The amount as invariant text without trailing zeros (<c>0.25</c>, <c>75</c>).</summary>
    public string AmountText => StrengthParser.Plain(Amount);

    /// <summary>The comparable token, e.g. <c>75 mg/ml</c>.</summary>
    public string Token => $"{AmountText} {Unit}";
}

/// <summary>
/// What a presentation text says about strength: <see cref="Amount"/> and <see cref="Display"/> (the strength as
/// written, units spelled normally, e.g. <c>75 mg/mL</c>) when it is one unambiguous amount, otherwise both
/// <c>null</c> (unknown: nothing is guessed).
/// </summary>
public sealed record StrengthReading(StrengthAmount? Amount, string? Display)
{
    public static StrengthReading Unknown { get; } = new(null, null);

    public bool IsKnown => Amount is not null;
}

/// <summary>
/// Conservative reader of the strength at the start of a CMED presentation text (<c>75 MG/ML EMU OR CT FR PLAS OPC GOT
/// X 15 ML</c>, <c>10 MG/5 ML</c>, <c>0,9 %</c>, <c>500 MG COM ...</c>). It accepts one amount of one active
/// ingredient and nothing else: a combination (<c>(10 + 0,4) MG/G</c>, <c>50 MG + 5 MG</c>), a range, a
/// parenthesised or second amount, an exponent (<c>1 X 10E7 GV/ML</c>, unknown unit), an unknown unit, a thousands separator that
/// could be a decimal point (<c>1.000 UI</c>), an inexact per-volume division, or a text without an amount at the start
/// is <see cref="StrengthReading.Unknown"/>. Units are normalised only where exactly equivalent (g, mg, mcg; 10 mg per
/// 5 mL = 2 mg/mL).
/// </summary>
public static partial class StrengthParser
{
    private const int DecimalPlaces = 12;

    private static readonly IReadOnlyDictionary<string, (string Unit, decimal Factor, string Display)> Numerators =
        new Dictionary<string, (string, decimal, string)>(StringComparer.Ordinal)
        {
            ["MG"] = ("mg", 1m, "mg"),
            ["G"] = ("mg", 1000m, "g"),
            ["MCG"] = ("mg", 0.001m, "mcg"),
            ["UG"] = ("mg", 0.001m, "mcg"),
            ["UI"] = ("ui", 1m, "UI"),
            ["U"] = ("u", 1m, "U"),
            ["MEQ"] = ("meq", 1m, "mEq"),
            ["MMOL"] = ("mmol", 1m, "mmol"),
            ["ML"] = ("ml", 1m, "mL"),
            ["%"] = ("%", 1m, "%"),
        };

    private static readonly IReadOnlyDictionary<string, (string Unit, string Display)> Denominators =
        new Dictionary<string, (string, string)>(StringComparer.Ordinal)
        {
            ["ML"] = ("ml", "mL"),
            ["G"] = ("g", "g"),
            ["L"] = ("l", "L"),
            ["DOSE"] = ("dose", "dose"),
            ["DIA"] = ("dia", "dia"),
            ["H"] = ("h", "h"),
        };

    /// <summary>The strength at the start of a CMED presentation text, or <see cref="StrengthReading.Unknown"/>.</summary>
    public static StrengthReading Read(string? presentation)
    {
        var text = (presentation ?? string.Empty).Trim();
        var match = Leading().Match(text);
        if (!match.Success)
        {
            return StrengthReading.Unknown;
        }

        var rest = text[match.Length..];
        if (!AllowedRest(rest))
        {
            return StrengthReading.Unknown;
        }

        return Build(match.Groups["n"].Value, match.Groups["u"].Value, match.Groups["dn"].Value, match.Groups["du"].Value) ?? StrengthReading.Unknown;
    }

    /// <summary>
    /// A structured strength (curated list): the amount text (<c>0,25</c>, <c>9</c>) and the unit (<c>mg/mL</c>, <c>%</c>,
    /// <c>mL/mL</c>, <c>mg/5 mL</c>) in canonical form, or <c>null</c> when either is not understood.
    /// </summary>
    public static StrengthAmount? Canonical(string? amount, string? unit)
    {
        var reading = Read($"{amount?.Trim()} {unit?.Trim()}".Trim() + " ");
        return reading.Amount;
    }

    /// <summary>An amount as invariant text without trailing zeros.</summary>
    public static string Plain(decimal value) =>
        decimal.Round(value, DecimalPlaces, MidpointRounding.ToEven).ToString("0.############", CultureInfo.InvariantCulture);

    private static StrengthReading? Build(string number, string numerator, string denominatorNumber, string denominator)
    {
        if (ParseNumber(number) is not { } amount || !Numerators.TryGetValue(numerator.ToUpperInvariant(), out var top))
        {
            return null;
        }

        var unit = top.Unit;
        var display = top.Display;
        var value = amount * top.Factor;
        if (denominator.Length > 0)
        {
            if (top.Unit == "%" || !Denominators.TryGetValue(denominator.ToUpperInvariant(), out var bottom))
            {
                return null;
            }

            var per = denominatorNumber.Length == 0 ? 1m : ParseNumber(denominatorNumber);
            if (per is null or <= 0m || Divide(value, per.Value) is not { } divided)
            {
                return null;
            }

            value = divided;
            unit = $"{top.Unit}/{bottom.Unit}";
            display = $"{top.Display}/{(denominatorNumber.Length > 0 ? denominatorNumber.Trim() + " " : string.Empty)}{bottom.Display}";
        }

        var shown = top.Unit == "%" ? $"{number.Trim()}%" : $"{number.Trim()} {display}";
        return new StrengthReading(new StrengthAmount(value, unit), shown);
    }

    /// <summary>The exact quotient, or <c>null</c> when it does not fit the decimal places kept.</summary>
    private static decimal? Divide(decimal value, decimal by)
    {
        var quotient = decimal.Round(value / by, DecimalPlaces, MidpointRounding.ToEven);
        return decimal.Round(quotient * by, DecimalPlaces) == decimal.Round(value, DecimalPlaces) ? quotient : null;
    }

    /// <summary>
    /// A decimal with a comma or a point; <c>null</c> when it could be read two ways (a point followed by exactly three
    /// digits is a thousands separator in Portuguese: <c>1.000</c>) or has both separators.
    /// </summary>
    private static decimal? ParseNumber(string text)
    {
        var value = text.Trim();
        var hasComma = value.Contains(',', StringComparison.Ordinal);
        var hasPoint = value.Contains('.', StringComparison.Ordinal);
        if ((hasComma && hasPoint) || (hasPoint && PointThousands().IsMatch(value)))
        {
            return null;
        }

        return decimal.TryParse(value.Replace(',', '.'), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }

    /// <summary>
    /// What may follow the strength: nothing, or the form words. A second amount, a combination sign, a bracket or a
    /// range right after the strength, or a <c>+</c> before the package size, means more than one amount.
    /// </summary>
    private static bool AllowedRest(string rest)
    {
        var trimmed = rest.TrimStart();
        if (trimmed.Length == 0)
        {
            return true;
        }

        return char.IsLetter(trimmed[0])
            && !StrayUnit().IsMatch(trimmed)
            && !PackageMarker().Split(trimmed, 2)[0].Contains('+', StringComparison.Ordinal);
    }

    [GeneratedRegex(@"^(?<n>\d+(?:[.,]\d+)?)\s*(?<u>MCG|UG|MG|G|UI|U|MEQ|MMOL|ML|%)(?![A-Za-z])(?:\s*/\s*(?<dn>\d+(?:[.,]\d+)?)?\s*(?<du>ML|G|L|DOSE|DIA|H)(?![A-Za-z]))?", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex Leading();

    [GeneratedRegex(@"^\d+[.]\d{3}$", RegexOptions.CultureInvariant)]
    private static partial Regex PointThousands();

    /// <summary>A unit word right after the strength (<c>75 MG ML</c>: the slash of <c>75 MG/ML</c> is missing): per unit or per mL, the text does not say.</summary>
    [GeneratedRegex(@"^(?:ML|L|G|MG|MCG|UG|UI|U|DOSE|DIA|H|MEQ|MMOL)(?![A-Za-z])", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex StrayUnit();

    [GeneratedRegex(@"\bX\s*\d", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex PackageMarker();
}
