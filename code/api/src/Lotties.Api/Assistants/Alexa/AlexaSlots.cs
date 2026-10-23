using System.Collections.Frozen;
using System.Globalization;
using Lotties.Domain.Assistants;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>
/// Reads the intent slots of the interaction models (<c>alexa/interaction-model.*.json</c>): the resolved value id of a
/// custom slot (<c>ER_SUCCESS_MATCH</c>), else the spoken value matched against the same synonyms, so a model without entity
/// resolution still works. Unknown values read as absent. Slot values are never logged.
/// </summary>
public static class AlexaSlots
{
    public const string AmountSlot = "amount";
    public const string KindSlot = "kind";
    public const string SideSlot = "side";

    private const int MaxAmount = 100_000;

    private static readonly FrozenDictionary<string, string> Synonyms = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["formula"] = "FORMULA",
        ["fórmula"] = "FORMULA",
        ["formula milk"] = "FORMULA",
        ["leite em pó"] = "FORMULA",
        ["breast milk"] = "BREAST_MILK",
        ["breastmilk"] = "BREAST_MILK",
        ["pumped milk"] = "BREAST_MILK",
        ["leite materno"] = "BREAST_MILK",
        ["leite do peito"] = "BREAST_MILK",
        ["left"] = "LEFT",
        ["esquerdo"] = "LEFT",
        ["esquerda"] = "LEFT",
        ["right"] = "RIGHT",
        ["direito"] = "RIGHT",
        ["direita"] = "RIGHT",
        ["wet"] = "WET",
        ["pee"] = "WET",
        ["xixi"] = "WET",
        ["molhada"] = "WET",
        ["dirty"] = "DIRTY",
        ["poop"] = "DIRTY",
        ["poopy"] = "DIRTY",
        ["cocô"] = "DIRTY",
        ["coco"] = "DIRTY",
        ["suja"] = "DIRTY",
        ["both"] = "BOTH",
        ["wet and dirty"] = "BOTH",
        ["os dois"] = "BOTH",
        ["ambos"] = "BOTH",
        ["xixi e cocô"] = "BOTH",
    }.ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);

    /// <summary>A whole number slot (<c>AMAZON.NUMBER</c>), or <c>null</c> when absent or not understood (<c>?</c>).</summary>
    public static int? Number(AlexaIntent? intent, string slot) =>
        Value(intent, slot) is { } text && int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var number) && number <= MaxAmount ? number : null;

    public static BottleKind BottleKind(AlexaIntent? intent) => Id(intent, KindSlot) switch
    {
        "FORMULA" => Domain.Assistants.BottleKind.Formula,
        "BREAST_MILK" => Domain.Assistants.BottleKind.BreastMilk,
        _ => Domain.Assistants.BottleKind.Unspecified,
    };

    public static BreastSide? Side(AlexaIntent? intent) => Id(intent, SideSlot) switch
    {
        "LEFT" => BreastSide.Left,
        "RIGHT" => BreastSide.Right,
        _ => null,
    };

    public static DiaperKind? Diaper(AlexaIntent? intent) => Id(intent, KindSlot) switch
    {
        "WET" => DiaperKind.Wet,
        "DIRTY" => DiaperKind.Dirty,
        "BOTH" => DiaperKind.Both,
        _ => null,
    };

    private static string? Id(AlexaIntent? intent, string slot) => ResolvedId(intent, slot) ?? SynonymOf(Value(intent, slot));

    private static string? ResolvedId(AlexaIntent? intent, string slot) =>
        SlotOf(intent, slot)?.Resolutions?.ResolutionsPerAuthority?
            .FirstOrDefault(resolution => resolution.Status?.Code == "ER_SUCCESS_MATCH")?
            .Values?.FirstOrDefault()?.Value?.Id;

    private static string? SynonymOf(string? spoken) =>
        spoken is not null && Synonyms.TryGetValue(spoken.Trim(), out var id) ? id : null;

    private static string? Value(AlexaIntent? intent, string slot) => SlotOf(intent, slot)?.Value is { Length: > 0 } value ? value : null;

    private static AlexaSlot? SlotOf(AlexaIntent? intent, string slot) =>
        intent?.Slots is { } slots && slots.TryGetValue(slot, out var found) ? found : null;
}
