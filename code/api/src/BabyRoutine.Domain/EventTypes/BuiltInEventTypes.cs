using BabyRoutine.Domain.Events;

namespace BabyRoutine.Domain.EventTypes;

/// <summary>
/// Built-in event type templates, seeded into the database with stable ids. Ids and keys must never change;
/// changing other values requires a new migration.
/// </summary>
/// <remarks>
/// The medication type has no field definitions: its payload is
/// <c>{"medications":[{"medicationId":"&lt;guid&gt;","name":"&lt;copy of the name&gt;","dose":{"amount":..,"unit":".."}}]}</c>
/// (dose optional), referencing the baby's medication catalog. Sleep <c>kind</c> also has the instant markers
/// <c>bed_time</c> and <c>woke_up</c> (Napper import). Feeding details depend on <c>method</c> (<see cref="FieldVisibilityCondition"/>):
/// <c>side</c> and the breast seconds for <c>breast</c>, <c>amount_ml</c> and <c>bottle_feeding_type</c> for <c>bottle</c>,
/// <c>food</c> for <c>solid</c>. Every type with a duration (and bath, which clients may time) declares the hidden pause
/// keys of <see cref="PauseFields"/>. Sleep has optional detail fields (<see cref="SleepDetailFields"/>) for the
/// <c>nap</c> and <c>night</c> kinds; its free-text <c>mood</c> is deprecated (replaced by <c>mood_on_wake</c>), hidden
/// from forms and kept only so older events stay valid and readable.
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
    public static readonly Guid BreastPumpId = new("ddfdaa52-57ee-4d34-8129-a78262c2172c");

    public static EventType Feeding { get; } = EventType.CreateBuiltIn(
        FeedingId,
        EventTypeKey.From("feeding"),
        "Feeding",
        "local_drink",
        HexColor.From("#4f8ef7"),
        hasDuration: true,
        [
            EventFieldDefinition.Create("method", "Method", EventFieldKind.Select, isRequired: true, options: ["breast", "bottle", "solid"]),
            EventFieldDefinition.Create("side", "Side", EventFieldKind.Select, options: ["left", "right", "both"], visibleWhen: WhenMethodIs("breast")),
            EventFieldDefinition.Create("amount_ml", "Amount", EventFieldKind.Number, min: 0, unit: "ml", visibleWhen: WhenMethodIs("bottle")),
            EventFieldDefinition.Create("bottle_feeding_type", "Bottle content", EventFieldKind.Select, options: ["formula", "breast_milk"], visibleWhen: WhenMethodIs("bottle")),
            EventFieldDefinition.Create("breast_left_seconds", "Left breast", EventFieldKind.Number, min: 0, unit: "s", visibleWhen: WhenMethodIs("breast")),
            EventFieldDefinition.Create("breast_right_seconds", "Right breast", EventFieldKind.Number, min: 0, unit: "s", visibleWhen: WhenMethodIs("breast")),
            EventFieldDefinition.Create("food", "Food", EventFieldKind.Text, visibleWhen: WhenMethodIs("solid")),
            .. PauseFieldDefinitions(),
        ]);

    public static EventType Sleep { get; } = EventType.CreateBuiltIn(
        SleepId,
        EventTypeKey.From("sleep"),
        "Sleep",
        "bedtime",
        HexColor.From("#7e57c2"),
        hasDuration: true,
        [
            EventFieldDefinition.Create("kind", "Kind", EventFieldKind.Select, options: ["nap", "night", "night_waking", "bed_time", "woke_up", "fell_asleep"]),
            EventFieldDefinition.Create("mood", "Mood", EventFieldKind.Text, isHidden: true),
            EventFieldDefinition.Create(SleepDetailFields.HowSlept, "How slept", EventFieldKind.Select, options: SleepDetailFields.HowSleptOptions, visibleWhen: WhenSleepDetailsApply()),
            EventFieldDefinition.Create(SleepDetailFields.FallAsleep, "Falling asleep", EventFieldKind.Select, options: SleepDetailFields.FallAsleepOptions, visibleWhen: WhenSleepDetailsApply()),
            EventFieldDefinition.Create(SleepDetailFields.TimeToFallAsleepMinutes, "Time to fall asleep", EventFieldKind.Number, min: 0, max: SleepDetailFields.MaxTimeToFallAsleepMinutes, unit: "min", visibleWhen: WhenSleepDetailsApply(), isInteger: true),
            EventFieldDefinition.Create(SleepDetailFields.HowWoke, "How woke", EventFieldKind.Select, options: SleepDetailFields.HowWokeOptions, visibleWhen: WhenSleepDetailsApply()),
            EventFieldDefinition.Create(SleepDetailFields.MoodOnWake, "Mood on waking", EventFieldKind.Select, options: SleepDetailFields.MoodOptions, visibleWhen: WhenSleepDetailsApply()),
            .. PauseFieldDefinitions(),
        ]);

    public static EventType Diaper { get; } = EventType.CreateBuiltIn(
        DiaperId,
        EventTypeKey.From("diaper"),
        "Diaper",
        "baby_changing_station",
        HexColor.From("#8d6e63"),
        hasDuration: false,
        [
            EventFieldDefinition.Create("content", "Content", EventFieldKind.Select, isRequired: true, options: ["WET", "DIRTY", "MIXED"]),
        ]);

    public static EventType Bath { get; } = EventType.CreateBuiltIn(
        BathId,
        EventTypeKey.From("bath"),
        "Bath",
        "bathtub",
        HexColor.From("#26a69a"),
        hasDuration: false,
        [
            EventFieldDefinition.Create("temperature_c", "Water temperature", EventFieldKind.Number, min: 0, max: 60, unit: "C"),
            .. PauseFieldDefinitions(),
        ]);

    public static EventType TummyTime { get; } = EventType.CreateBuiltIn(
        TummyTimeId,
        EventTypeKey.From("tummy_time"),
        "Tummy time",
        "child_care",
        HexColor.From("#ffa726"),
        hasDuration: true,
        [
            EventFieldDefinition.Create("mood", "Mood", EventFieldKind.Text),
            .. PauseFieldDefinitions(),
        ]);

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

    public static EventType BreastPump { get; } = EventType.CreateBuiltIn(
        BreastPumpId,
        EventTypeKey.From("breast_pump"),
        "Breast pump",
        "opacity",
        HexColor.From("#26c6da"),
        hasDuration: true,
        [
            EventFieldDefinition.Create("amount_left_ml", "Left amount", EventFieldKind.Number, min: 0, unit: "ml"),
            EventFieldDefinition.Create("amount_right_ml", "Right amount", EventFieldKind.Number, min: 0, unit: "ml"),
            .. PauseFieldDefinitions(),
        ]);

    public static IReadOnlyList<EventType> All { get; } = Array.AsReadOnly(
        new[] { Feeding, Sleep, Diaper, Bath, TummyTime, Medication, BellyPain, BreastPump });

    private static FieldVisibilityCondition WhenMethodIs(string method) => FieldVisibilityCondition.Create("method", [method]);

    private static FieldVisibilityCondition WhenSleepDetailsApply() => FieldVisibilityCondition.Create("kind", SleepDetailFields.Kinds);

    /// <summary>The reserved pause keys (<see cref="PauseFields"/>), hidden from forms: timers fill them on pause/resume.</summary>
    private static EventFieldDefinition[] PauseFieldDefinitions() =>
    [
        EventFieldDefinition.Create(PauseFields.PauseCount, "Pauses", EventFieldKind.Number, min: 0, max: PauseFields.MaxPauseCount, isHidden: true, isInteger: true),
        EventFieldDefinition.Create(PauseFields.PausedSeconds, "Paused time", EventFieldKind.Number, min: 0, max: PauseFields.MaxPausedSeconds, unit: "s", isHidden: true, isInteger: true),
        EventFieldDefinition.Create(PauseFields.PausedAt, "Paused at", EventFieldKind.Text, isHidden: true),
    ];
}
