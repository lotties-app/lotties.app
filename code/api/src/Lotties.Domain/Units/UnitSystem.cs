namespace Lotties.Domain.Units;

/// <summary>
/// The unit system a person sees, says and types (docs/design/37-measurement-units.md). Storage is metric forever
/// (ml, kg, cm, degrees C); this only changes presentation and input.
/// </summary>
public enum UnitSystem
{
    /// <summary>ml, kg, cm, degrees Celsius.</summary>
    Metric,

    /// <summary>US customary: fl oz, lb and oz, inches, degrees Fahrenheit.</summary>
    Us,
}

/// <summary>What a person chose: a system, or <see cref="Auto"/> (by locale, see <see cref="UnitSystems.Resolve"/>).</summary>
public enum UnitSetting
{
    Auto,
    Metric,
    Us,
}

/// <summary>The unit setting's wire names (<c>auto</c>, <c>metric</c>, <c>us</c>) and the locale rule of <c>auto</c>.</summary>
public static class UnitSystems
{
    public const string AutoName = "auto";
    public const string MetricName = "metric";
    public const string UsName = "us";

    /// <summary>The setting of a wire name (exact, case-insensitive), or <c>false</c> for anything else.</summary>
    public static bool TryParse(string? name, out UnitSetting setting)
    {
        setting = default;
        if (name is null)
        {
            return false;
        }

        switch (name.Trim().ToLowerInvariant())
        {
            case AutoName:
                setting = UnitSetting.Auto;
                return true;
            case MetricName:
                setting = UnitSetting.Metric;
                return true;
            case UsName:
                setting = UnitSetting.Us;
                return true;
            default:
                return false;
        }
    }

    /// <summary>The setting of a wire name, <see cref="UnitSetting.Auto"/> for anything else (a stored value is always a known name).</summary>
    public static UnitSetting ParseOrAuto(string? name) => TryParse(name, out var setting) ? setting : UnitSetting.Auto;

    public static string NameOf(UnitSetting setting) => setting switch
    {
        UnitSetting.Metric => MetricName,
        UnitSetting.Us => UsName,
        _ => AutoName,
    };

    /// <summary>
    /// The system a setting means for a locale tag: <c>metric</c> and <c>us</c> are themselves; <c>auto</c> is <c>us</c> when
    /// the tag's region is US, LR or MM (the countries that use US customary units), else metric (a bare language, an
    /// empty or unreadable tag included).
    /// </summary>
    public static UnitSystem Resolve(UnitSetting setting, string? localeTag) => setting switch
    {
        UnitSetting.Metric => UnitSystem.Metric,
        UnitSetting.Us => UnitSystem.Us,
        _ => UsRegion(localeTag) ? UnitSystem.Us : UnitSystem.Metric,
    };

    private static bool UsRegion(string? localeTag)
    {
        if (string.IsNullOrWhiteSpace(localeTag))
        {
            return false;
        }

        foreach (var part in localeTag.Split('-', '_').Skip(1))
        {
            if (part.Length == 2 && part.All(char.IsAsciiLetter))
            {
                return part.ToUpperInvariant() is "US" or "LR" or "MM";
            }
        }

        return false;
    }
}

/// <summary>A volume unit a person may say or type for a bottle.</summary>
public enum VolumeUnit
{
    Milliliters,
    FluidOunces,
}

/// <summary>A temperature unit a person may say or type for a reading or the bath water.</summary>
public enum TemperatureUnit
{
    Celsius,
    Fahrenheit,
}
