namespace BabyRoutine.Domain.EventTypes;

/// <summary>
/// Built-in event type templates, seeded into the database with stable ids. Ids and keys must never change;
/// changing other values requires a new migration.
/// </summary>
/// <remarks>
/// The medication type has no field definitions: its payload is
/// <c>{"medications":[{"medicationId":"&lt;guid&gt;","dose":"&lt;text, optional&gt;"}]}</c>, referencing the baby's
/// medication catalog.
/// </remarks>
public static class BuiltInEventTypes
{
    public static readonly Guid FeedingId = new("e6428ccb-7061-4cf4-a5d0-67c89a396a5f");
    public static readonly Guid SleepId = new("5cbe3692-d4df-4d5f-85d6-2282d9733b35");
    public static readonly Guid DiaperId = new("318d1395-e373-4d89-a3cd-cdd7ad5187ab");
    public static readonly Guid BathId = new("833cf001-7e12-4bc6-b7a5-7adabb174aa5");
    public static readonly Guid TummyTimeId = new("543cbd04-e226-435c-9639-810ecd066056");
    public static readonly Guid MedicationId = new("bd43d7fb-e12c-438a-852e-c710b41a7c76");
    public static readonly Guid BellyPainId = new("07a1ea45-7ba6-4fe3-9e38-a335da9ea12c");

    public static EventType Feeding { get; } = EventType.CreateBuiltIn(
        FeedingId,
        EventTypeKey.From("feeding"),
        "Feeding",
        "local_drink",
        HexColor.From("#4f8ef7"),
        hasDuration: true,
        [
            EventFieldDefinition.Create("method", "Method", EventFieldKind.Select, isRequired: true, options: ["breast", "bottle", "solid"]),
            EventFieldDefinition.Create("side", "Side", EventFieldKind.Select, options: ["left", "right", "both"]),
            EventFieldDefinition.Create("amount", "Amount", EventFieldKind.Number, min: 0, unit: "ml"),
        ]);

    public static EventType Sleep { get; } = EventType.CreateBuiltIn(
        SleepId,
        EventTypeKey.From("sleep"),
        "Sleep",
        "bedtime",
        HexColor.From("#7e57c2"),
        hasDuration: true,
        []);

    public static EventType Diaper { get; } = EventType.CreateBuiltIn(
        DiaperId,
        EventTypeKey.From("diaper"),
        "Diaper",
        "baby_changing_station",
        HexColor.From("#8d6e63"),
        hasDuration: false,
        []);

    public static EventType Bath { get; } = EventType.CreateBuiltIn(
        BathId,
        EventTypeKey.From("bath"),
        "Bath",
        "bathtub",
        HexColor.From("#26a69a"),
        hasDuration: false,
        []);

    public static EventType TummyTime { get; } = EventType.CreateBuiltIn(
        TummyTimeId,
        EventTypeKey.From("tummy_time"),
        "Tummy time",
        "child_care",
        HexColor.From("#ffa726"),
        hasDuration: true,
        []);

    public static EventType Medication { get; } = EventType.CreateBuiltIn(
        MedicationId,
        EventTypeKey.From("medication"),
        "Medication",
        "medication",
        HexColor.From("#ef5350"),
        hasDuration: false,
        []);

    public static EventType BellyPain { get; } = EventType.CreateBuiltIn(
        BellyPainId,
        EventTypeKey.From("belly_pain"),
        "Belly pain",
        "sick",
        HexColor.From("#ec407a"),
        hasDuration: false,
        [
            EventFieldDefinition.Create("intensity", "Intensity", EventFieldKind.Number, isRequired: true, min: 1, max: 5),
        ]);

    public static IReadOnlyList<EventType> All { get; } = Array.AsReadOnly(
        new[] { Feeding, Sleep, Diaper, Bath, TummyTime, Medication, BellyPain });
}
