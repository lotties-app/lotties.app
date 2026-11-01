using System.Globalization;

namespace Lotties.Domain.Units;

/// <summary>
/// Pure conversions between the stored metric values and US customary units, with the exact rounding of the shared vectors
/// (code/web/src/units/unitsVectors.json, docs/design/37-measurement-units.md). Display rounding: fl oz to 1 decimal, weight
/// to whole ounces (lb + oz), inches to 1 decimal, Fahrenheit to 1 decimal. Input rounding: whole ml, whole grams, 0.1 cm,
/// 0.1 C. Halves round away from zero; decimals avoid binary float surprises. Never used for a medication dose.
/// </summary>
public static class UnitConversions
{
    private const decimal MlPerFluidOunce = 29.5735m;
    private const decimal OuncesPerKg = 35.27396m;
    private const decimal GramsPerOunce = 28.349523m;
    private const decimal CmPerInch = 2.54m;
    private const int OuncesPerPound = 16;

    /// <summary>A weight in US customary: whole pounds and the remaining whole ounces (0..15).</summary>
    public readonly record struct PoundsOunces(int Pounds, int Ounces)
    {
        public int TotalOunces => (Pounds * OuncesPerPound) + Ounces;
    }

    /// <summary>Fluid ounces for a volume in ml, to 1 decimal.</summary>
    public static decimal MlToFluidOunces(decimal ml) => Round(ml / MlPerFluidOunce, 1);

    /// <summary>Whole ml for a volume in fluid ounces.</summary>
    public static int FluidOuncesToMl(decimal ounces) => (int)Round(ounces * MlPerFluidOunce, 0);

    /// <summary>Whole pounds and ounces (ounces rounded to whole) for a weight in kg.</summary>
    public static PoundsOunces KgToPoundsOunces(decimal kg)
    {
        var ounces = (int)Round(kg * OuncesPerKg, 0);
        return new PoundsOunces(ounces / OuncesPerPound, ounces % OuncesPerPound);
    }

    /// <summary>Kg (whole grams) for pounds and ounces.</summary>
    public static decimal PoundsOuncesToKg(int pounds, decimal ounces) =>
        Round((pounds * OuncesPerPound + ounces) * GramsPerOunce, 0) / 1000m;

    /// <summary>Inches (1 decimal) for a length in cm.</summary>
    public static decimal CmToInches(decimal cm) => Round(cm / CmPerInch, 1);

    /// <summary>Cm (0.1) for a length in inches.</summary>
    public static decimal InchesToCm(decimal inches) => Round(inches * CmPerInch, 1);

    /// <summary>Degrees Fahrenheit (1 decimal) for degrees Celsius.</summary>
    public static decimal CelsiusToFahrenheit(decimal celsius) => Round((celsius * 9m / 5m) + 32m, 1);

    /// <summary>Degrees Celsius (0.1) for degrees Fahrenheit.</summary>
    public static decimal FahrenheitToCelsius(decimal fahrenheit) => Round((fahrenheit - 32m) * 5m / 9m, 1);

    /// <summary>A number as the vectors write it: invariant, at most one decimal, no trailing <c>.0</c> (<c>4</c>, <c>4.1</c>).</summary>
    public static string Text(decimal value) => value.ToString("0.#", CultureInfo.InvariantCulture);

    private static decimal Round(decimal value, int decimals) => Math.Round(value, decimals, MidpointRounding.AwayFromZero);
}
