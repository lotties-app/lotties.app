namespace Lotties.Domain.Assistants;

/// <summary>What a bottle held, as an assistant command names it.</summary>
public enum BottleKind
{
    /// <summary>Not said: the bottle is logged without <c>bottle_feeding_type</c>.</summary>
    Unspecified,

    /// <summary><c>bottle_feeding_type: formula</c>, naming the baby's current formula when there is one.</summary>
    Formula,

    /// <summary><c>bottle_feeding_type: breast_milk</c>.</summary>
    BreastMilk,
}

/// <summary>A breast side (nursing).</summary>
public enum BreastSide
{
    Left,
    Right,
}

/// <summary>A diaper's content, as an assistant command names it (stored as <c>WET</c>, <c>DIRTY</c>, <c>MIXED</c>).</summary>
public enum DiaperKind
{
    Wet,
    Dirty,
    Both,
}

/// <summary>How a feeding was given (the feeding <c>method</c>).</summary>
public enum FeedMethod
{
    /// <summary>No (or an unknown) method was recorded.</summary>
    Unknown,
    Breast,
    Bottle,
    Solid,
}

/// <summary>Limits of the values an assistant command takes.</summary>
public static class AssistantLimits
{
    /// <summary>The smallest bottle a voice command logs, in ml.</summary>
    public const int BottleMinMl = 1;

    /// <summary>The largest bottle a voice command logs, in ml (the Feed tray's stepper limit).</summary>
    public const int BottleMaxMl = 500;

    /// <summary>Whether <paramref name="amountMl"/> is a bottle a voice command may log.</summary>
    public static bool IsBottleAmount(int? amountMl) => amountMl is >= BottleMinMl and <= BottleMaxMl;

    /// <summary>The weakest and strongest belly pain level (the <c>belly_pain</c> field's own limits).</summary>
    public const int PainMin = 1;

    public const int PainMax = 5;

    /// <summary>The coolest and warmest temperature reading in degrees Celsius (the <c>temperature</c> field's own limits).</summary>
    public const int TemperatureMinC = 30;

    public const int TemperatureMaxC = 45;

    /// <summary>The coolest and warmest bath water in degrees Celsius (the <c>bath</c> field's own limits).</summary>
    public const int BathWaterMinC = 0;

    public const int BathWaterMaxC = 60;

    /// <summary>The least and most a breast pump side gives in one voice command, in ml (the bottle's stepper limit).</summary>
    public const int PumpMinMl = 1;

    public const int PumpMaxMl = 500;

    /// <summary>The shortest and longest activity a voice command logs after the fact ("15 minutes of tummy time"), in minutes (12 hours).</summary>
    public const int ActivityMinMinutes = 1;

    public const int ActivityMaxMinutes = 720;

    public static bool IsActivityMinutes(int minutes) => minutes is >= ActivityMinMinutes and <= ActivityMaxMinutes;

    public static bool IsPain(int? level) => level is >= PainMin and <= PainMax;

    public static bool IsTemperatureC(decimal celsius) => celsius is >= TemperatureMinC and <= TemperatureMaxC;

    public static bool IsBathWaterC(decimal celsius) => celsius is >= BathWaterMinC and <= BathWaterMaxC;

    public static bool IsPumpAmount(int? amountMl) => amountMl is >= PumpMinMl and <= PumpMaxMl;
}

/// <summary>
/// The values an assistant command may store in a select field. They are the options of the built-in event type's field
/// itself (<see cref="EventTypes.BuiltInEventTypes"/>), so a voice command can never write a value the app does not offer, and
/// never free text: anything that is not an option reads as "not said" (<c>null</c>).
/// </summary>
public static class AssistantChoices
{
    public static string? FussyIntensity(string? value) => Pick(EventTypes.BuiltInEventTypes.Fussy, "intensity", value);

    public static string? FussyWhatHelped(string? value) => Pick(EventTypes.BuiltInEventTypes.Fussy, "what_helped", value);

    public static string? NasalTool(string? value) => Pick(EventTypes.BuiltInEventTypes.NasalSuction, "tool", value);

    public static string? MassageReason(string? value) => Pick(EventTypes.BuiltInEventTypes.BellyMassage, "reason", value);

    public static string? MassageHelped(string? value) => Pick(EventTypes.BuiltInEventTypes.BellyMassage, "helped", value);

    public static string? NailWhere(string? value) => Pick(EventTypes.BuiltInEventTypes.NailTrim, "where", value);

    public static string? TemperatureMethod(string? value) => Pick(EventTypes.BuiltInEventTypes.Temperature, "method", value);

    public static string? SpitUpKind(string? value) => Pick(EventTypes.BuiltInEventTypes.SpitUp, "kind", value);

    public static string? SpitUpAmount(string? value) => Pick(EventTypes.BuiltInEventTypes.SpitUp, "amount", value);

    public static string? TeethingStage(string? value) => Pick(EventTypes.BuiltInEventTypes.Teething, "stage", value);

    public static string? TeethingTooth(string? value) => Pick(EventTypes.BuiltInEventTypes.Teething, "tooth", value);

    /// <summary>A milestone, never <c>other</c> (it would need its own words, which voice never stores).</summary>
    public static string? Milestone(string? value) => Pick(EventTypes.BuiltInEventTypes.Milestone, "milestone", value) is { } picked && picked != Other ? picked : null;

    /// <summary>A symptom, never <c>other</c>.</summary>
    public static string? Symptom(string? value) => Pick(EventTypes.BuiltInEventTypes.Symptom, "symptom", value) is { } picked && picked != Other ? picked : null;

    public static string? SymptomSeverity(string? value) => Pick(EventTypes.BuiltInEventTypes.Symptom, "severity", value);

    public static string? OutdoorKind(string? value) => Pick(EventTypes.BuiltInEventTypes.Outdoor, "kind", value);

    public static string? SkinProduct(string? value) => Pick(EventTypes.BuiltInEventTypes.SkinCare, "product", value);

    /// <summary>The options a voice model or a tool may offer for each select (the field's options, <c>other</c> left out where voice stores no words).</summary>
    public static IReadOnlyList<string> FussyIntensities { get; } = OptionsOf(EventTypes.BuiltInEventTypes.Fussy, "intensity");

    public static IReadOnlyList<string> TemperatureMethods { get; } = OptionsOf(EventTypes.BuiltInEventTypes.Temperature, "method");

    public static IReadOnlyList<string> Milestones { get; } = OptionsOf(EventTypes.BuiltInEventTypes.Milestone, "milestone").Where(option => option != Other).ToArray();

    public static IReadOnlyList<string> Symptoms { get; } = OptionsOf(EventTypes.BuiltInEventTypes.Symptom, "symptom").Where(option => option != Other).ToArray();

    public static IReadOnlyList<string> Severities { get; } = OptionsOf(EventTypes.BuiltInEventTypes.Symptom, "severity");

    /// <summary>The options of a built-in field (what a model or a tool may offer).</summary>
    public static IReadOnlyList<string> OptionsOf(EventTypes.EventType type, string field) =>
        type.Fields.Single(candidate => candidate.Key == field).Options;

    private const string Other = "other";

    private static string? Pick(EventTypes.EventType type, string field, string? value) =>
        value is not null && OptionsOf(type, field).Contains(value, StringComparer.Ordinal) ? value : null;
}
