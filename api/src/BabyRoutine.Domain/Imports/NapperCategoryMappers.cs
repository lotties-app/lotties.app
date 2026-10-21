using System.Collections.Frozen;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Imports;

/// <summary>Maps the rows of one or more Napper categories to a built-in event type.</summary>
internal interface INapperCategoryMapper
{
    EventType Type { get; }

    bool CanHandle(string category);

    NapperRowOutcome Map(NapperLogRow row);
}

/// <summary><c>BOTTLE</c> -> feeding, method <c>bottle</c>, <c>amount_ml</c> from <c>feedingAmount</c>, <c>bottle_feeding_type</c>.</summary>
internal sealed class BottleMapper : INapperCategoryMapper
{
    private static readonly FrozenSet<string> BottleContents = new[] { "FORMULA", "BREAST_MILK" }.ToFrozenSet(StringComparer.Ordinal);

    public EventType Type => BuiltInEventTypes.Feeding;

    public bool CanHandle(string category) => category == "BOTTLE";

    /// <remarks>An unknown bottle content is kept in the notes instead of the select field.</remarks>
    public NapperRowOutcome Map(NapperLogRow row)
    {
        var content = row.BottleFeedingType?.Trim().ToUpperInvariant();
        var knownContent = content is not null && BottleContents.Contains(content) ? content : null;
        var payload = new PayloadBuilder()
            .With("method", "bottle")
            .With("amount_ml", row.FeedingAmount)
            .With("bottle_feeding_type", knownContent)
            .Build();
        var notes = NapperNotes.Compose(row.Comment, knownContent is null ? NapperNotes.Line("Bottle content", row.BottleFeedingType) : null);
        return NapperRowOutcome.Mapped(new NapperEventDraft(row, Type, row.Start, row.End ?? row.Start, payload, notes, []));
    }
}

/// <summary>
/// <c>NURSING</c> -> feeding, method <c>breast</c>, left/right seconds and the side they imply (left, right or both).
/// When Napper stored the session as an instant, the end becomes start plus the nursed seconds.
/// </summary>
internal sealed class NursingMapper : INapperCategoryMapper
{
    public EventType Type => BuiltInEventTypes.Feeding;

    public bool CanHandle(string category) => category == "NURSING";

    public NapperRowOutcome Map(NapperLogRow row)
    {
        var payload = new PayloadBuilder()
            .With("method", "breast")
            .With("side", SideOf(row.BreastLeftSeconds, row.BreastRightSeconds))
            .With("breast_left_seconds", row.BreastLeftSeconds)
            .With("breast_right_seconds", row.BreastRightSeconds)
            .Build();
        var notes = NapperNotes.Compose(row.Comment, NapperNotes.Line("Pauses", row.NumberOfPauses), NapperNotes.Line("Paused minutes", row.PausedMinutes));
        return NapperRowOutcome.Mapped(new NapperEventDraft(row, Type, row.Start, EndOf(row), payload, notes, []));
    }

    private static string? SideOf(int? leftSeconds, int? rightSeconds) => (leftSeconds > 0, rightSeconds > 0) switch
    {
        (true, true) => "both",
        (true, false) => "left",
        (false, true) => "right",
        _ => null,
    };

    private static DateTimeOffset EndOf(NapperLogRow row)
    {
        var nursedSeconds = Math.Max(row.BreastLeftSeconds ?? 0, 0) + Math.Max(row.BreastRightSeconds ?? 0, 0);
        var storedAsInstant = row.End is null || row.End == row.Start;
        return storedAsInstant ? row.Start.AddSeconds(nursedSeconds) : row.End!.Value;
    }
}

/// <summary><c>CHANGED_DIAPER</c> -> diaper with the required <c>content</c> WET|DIRTY|MIXED (an instant).</summary>
internal sealed class DiaperMapper : INapperCategoryMapper
{
    private static readonly FrozenSet<string> Contents = new[] { "WET", "DIRTY", "MIXED" }.ToFrozenSet(StringComparer.Ordinal);

    public EventType Type => BuiltInEventTypes.Diaper;

    public bool CanHandle(string category) => category == "CHANGED_DIAPER";

    public NapperRowOutcome Map(NapperLogRow row)
    {
        var content = row.DiaperContent?.Trim().ToUpperInvariant();
        if (content is null || !Contents.Contains(content))
        {
            return NapperRowOutcome.Skipped(row, ImportSkipCodes.MissingValue, "diaperContent must be WET, DIRTY or MIXED.");
        }

        var payload = new PayloadBuilder().With("content", content).Build();
        return NapperRowOutcome.Mapped(new NapperEventDraft(row, Type, row.Start, row.Start, payload, NapperNotes.Compose(row.Comment), []));
    }
}

/// <summary>
/// <c>NAP</c>, <c>NIGHT_WAKING</c> (durations) and <c>BED_TIME</c>, <c>WOKE_UP</c> (instants) -> sleep with
/// <c>kind</c> nap|night_waking|bed_time|woke_up. <c>mood</c> is the mood on wake-up (else how the baby slept); the
/// other sleep attributes go to the notes.
/// </summary>
internal sealed class SleepMapper : INapperCategoryMapper
{
    private static readonly FrozenDictionary<string, SleepKind> Kinds = new Dictionary<string, SleepKind>(StringComparer.Ordinal)
    {
        ["NAP"] = new("nap", IsInstant: false),
        ["NIGHT_WAKING"] = new("night_waking", IsInstant: false),
        ["BED_TIME"] = new("bed_time", IsInstant: true),
        ["WOKE_UP"] = new("woke_up", IsInstant: true),
    }.ToFrozenDictionary(StringComparer.Ordinal);

    public EventType Type => BuiltInEventTypes.Sleep;

    public bool CanHandle(string category) => Kinds.ContainsKey(category);

    public NapperRowOutcome Map(NapperLogRow row)
    {
        var kind = Kinds[row.Category];
        if (!kind.IsInstant && row.End is null)
        {
            return NapperRowOutcome.Skipped(row, ImportSkipCodes.MissingValue, "end is empty (the sleep is still running in Napper).");
        }

        var moodOnWakeUp = NonBlank(row.BabyMoodOnWakeUp);
        var payload = new PayloadBuilder().With("kind", kind.Value).With("mood", moodOnWakeUp ?? NonBlank(row.HowBabySlept)).Build();
        var notes = NapperNotes.Compose(
            row.Comment,
            NapperNotes.Line("Mood on sleep", row.BabyMoodOnSleep),
            moodOnWakeUp is null ? null : NapperNotes.Line("How baby slept", row.HowBabySlept),
            NapperNotes.Line("How baby woke", row.HowBabyWoke),
            NapperNotes.Line("Time to fall asleep", row.TimeToFallAsleep));
        var end = kind.IsInstant ? row.Start : row.End!.Value;
        return NapperRowOutcome.Mapped(new NapperEventDraft(row, Type, row.Start, end, payload, notes, []));
    }

    private static string? NonBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private sealed record SleepKind(string Value, bool IsInstant);
}

/// <summary>
/// <c>MEDICINE</c> -> medication (an instant). The free-text comment is split into medication names
/// (<see cref="MedicationTokenizer"/>) that the import resolves against the catalog; the comment is not kept as notes.
/// </summary>
internal sealed class MedicineMapper : INapperCategoryMapper
{
    public EventType Type => BuiltInEventTypes.Medication;

    public bool CanHandle(string category) => category == "MEDICINE";

    public NapperRowOutcome Map(NapperLogRow row)
    {
        var tokens = MedicationTokenizer.Split(row.Comment);
        return tokens.Count == 0
            ? NapperRowOutcome.Skipped(row, ImportSkipCodes.MissingValue, "comment names no medication.")
            : NapperRowOutcome.Mapped(new NapperEventDraft(row, Type, row.Start, row.Start, EventPayload.Empty, null, tokens));
    }
}
