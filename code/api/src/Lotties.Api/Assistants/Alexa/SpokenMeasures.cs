using System.Globalization;
using Lotties.Domain.Units;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>A unit's spoken name: singular and plural.</summary>
internal sealed record SpokenUnit(string One, string Many);

/// <summary>The unit words of one language (docs/design/37-measurement-units.md); <c>And</c> joins pounds and ounces.</summary>
internal sealed record SpokenUnitWords(
    string Milliliters,
    SpokenUnit Ounce,
    SpokenUnit Pound,
    SpokenUnit Kilogram,
    SpokenUnit Centimeter,
    SpokenUnit Inch,
    SpokenUnit Degree,
    string And);

/// <summary>
/// Volumes, weights, lengths and temperatures in words, in the unit system the answer is told in. The numbers come from the
/// shared conversions (<see cref="UnitConversions"/>: the same rounding as the app and the vectors); metric volumes read as
/// before (<c>120 ml</c>). Only volumes, weights, lengths and temperatures go through here: never a dose.
/// </summary>
internal sealed class SpokenMeasures(CultureInfo culture, SpokenUnitWords words, Func<decimal, bool> isSingular)
{
    public string Volume(int ml, UnitSystem units) => units == UnitSystem.Us
        ? Amount(UnitConversions.MlToFluidOunces(ml), words.Ounce)
        : $"{ml.ToString(culture)} {words.Milliliters}";

    /// <summary>A volume before a noun in English ("a 4 ounce bottle", "a 120 ml bottle"): the unit stays singular.</summary>
    public string VolumeModifier(int ml, UnitSystem units) => units == UnitSystem.Us
        ? $"{Number(UnitConversions.MlToFluidOunces(ml))} {words.Ounce.One}"
        : $"{ml.ToString(culture)} {words.Milliliters}";

    public string Weight(decimal kg, UnitSystem units)
    {
        if (units == UnitSystem.Metric)
        {
            return Amount(kg, words.Kilogram);
        }

        var weight = UnitConversions.KgToPoundsOunces(kg);
        return weight.Pounds == 0
            ? Amount(weight.Ounces, words.Ounce)
            : weight.Ounces == 0
                ? Amount(weight.Pounds, words.Pound)
                : $"{Amount(weight.Pounds, words.Pound)} {(words.And.Length == 0 ? string.Empty : words.And + " ")}{Amount(weight.Ounces, words.Ounce)}";
    }

    public string Length(decimal cm, UnitSystem units) => units == UnitSystem.Us
        ? Amount(UnitConversions.CmToInches(cm), words.Inch)
        : Amount(cm, words.Centimeter);

    public string Temperature(decimal celsius, UnitSystem units) =>
        Amount(units == UnitSystem.Us ? UnitConversions.CelsiusToFahrenheit(celsius) : celsius, words.Degree);

    /// <summary>A number as spoken in this culture: at most one decimal (<c>4.1</c>, <c>4,1</c>).</summary>
    public string Number(decimal value) => value.ToString("0.#", culture);

    private string Amount(decimal value, SpokenUnit unit) => $"{Number(value)} {(isSingular(value) ? unit.One : unit.Many)}";
}
