using System.Collections.Frozen;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Imports;

/// <summary>Maps the rows of one or more Napper categories to a built-in event type.</summary>
internal interface INapperCategoryMapper
{
    EventType Type { get; }

    bool CanHandle(string category);

    NapperRowOutcome Map(NapperLogRow row);
}

/// <summary>
/// <c>BOTTLE</c> -> feeding, method <c>bottle</c>, <c>amount_ml</c> from <c>feedingAmount</c>, <c>bottle_feeding_type</c>
/// from Napper's <c>FORMULA</c>|<c>BREAST_MILK</c> as the option values <c>formula</c>|<c>breast_milk</c> (case-insensitive).
/// </summary>
internal sealed class BottleMapper : INapperCategoryMapper
{
    private static readonly FrozenSet<string> BottleContents = new[] { "formula", "breast_milk" }.ToFrozenSet(StringComparer.Ordinal);

    public EventType Type => BuiltInEventTypes.Feeding;

    public bool CanHandle(string category) => category == "BOTTLE";

    /// <remarks>An unknown bottle content is kept in the notes instead of the select field.</remarks>
    public NapperRowOutcome Map(NapperLogRow row)
    {
        var content = row.BottleFeedingType?.Trim().ToLowerInvariant();
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
/// <c>NURSING</c> -> feeding, method <c>breast</c>, left/right seconds and the side they imply (left, right or both),
/// plus the pauses (<see cref="NapperDetails.AddPauses"/>). When Napper stored the session as an instant, the end becomes
/// start plus the nursed seconds.
/// </summary>
internal sealed class NursingMapper : INapperCategoryMapper
{
    public EventType Type => BuiltInEventTypes.Feeding;

    public bool CanHandle(string category) => category == "NURSING";

    public NapperRowOutcome Map(NapperLogRow row)
    {
        var end = EndOf(row);
        var details = new NapperDetails(row);
        var payload = new PayloadBuilder()
            .With("method", "breast")
            .With("side", SideOf(row.BreastLeftSeconds, row.BreastRightSeconds))
            .With("breast_left_seconds", row.BreastLeftSeconds)
            .With("breast_right_seconds", row.BreastRightSeconds);
        var built = details.AddPauses(payload, row.Start, end).Build();
        var draft = new NapperEventDraft(row, Type, row.Start, end, built, NapperNotes.Compose(row.Comment, details.NotesLines), [])
        {
            SkippedFields = details.SkippedFields,
        };
        return NapperRowOutcome.Mapped(draft);
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

/// <summary>
/// <c>PUMPING</c> and <c>BREAST_PUMP</c> -> breast_pump with <c>amount_left_ml</c>/<c>amount_right_ml</c> from
/// <c>amountPumpedLeft</c>/<c>amountPumpedRight</c>; an empty end becomes the start.
/// </summary>
internal sealed class BreastPumpMapper : INapperCategoryMapper
{
    private static readonly FrozenSet<string> Categories = new[] { "PUMPING", "BREAST_PUMP" }.ToFrozenSet(StringComparer.Ordinal);

    public EventType Type => BuiltInEventTypes.BreastPump;

    public bool CanHandle(string category) => Categories.Contains(category);

    public NapperRowOutcome Map(NapperLogRow row)
    {
        var payload = new PayloadBuilder()
            .With("amount_left_ml", row.AmountPumpedLeft)
            .With("amount_right_ml", row.AmountPumpedRight)
            .Build();
        return NapperRowOutcome.Mapped(new NapperEventDraft(row, Type, row.Start, row.End ?? row.Start, payload, NapperNotes.Compose(row.Comment), []));
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
/// <c>kind</c> nap|night_waking|bed_time|woke_up. Naps get the sleep detail fields
/// (<see cref="NapperDetails.AddSleepDetails"/>); the other kinds have no detail fields, so their sleep columns become
/// notes lines. Durations (naps and night wakings) get their pauses. The deprecated free-text <c>mood</c> is no longer
/// written.
/// </summary>
internal sealed class SleepMapper : INapperCategoryMapper
{
    private static readonly FrozenDictionary<string, SleepKind> Kinds = new Dictionary<string, SleepKind>(StringComparer.Ordinal)
    {
        ["NAP"] = new("nap", IsInstant: false, HasDetails: true),
        ["NIGHT_WAKING"] = new("night_waking", IsInstant: false, HasDetails: false),
        ["BED_TIME"] = new("bed_time", IsInstant: true, HasDetails: false),
        ["WOKE_UP"] = new("woke_up", IsInstant: true, HasDetails: false),
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

        var end = kind.IsInstant ? row.Start : row.End!.Value;
        var details = new NapperDetails(row);
        var payload = new PayloadBuilder().With("kind", kind.Value);
        var withSleep = kind.HasDetails ? details.AddSleepDetails(payload) : details.AddSleepNotes(payload);
        var withPauses = kind.IsInstant ? withSleep : details.AddPauses(withSleep, row.Start, end);
        var draft = new NapperEventDraft(row, Type, row.Start, end, withPauses.Build(), NapperNotes.Compose(row.Comment, details.NotesLines), [])
        {
            SkippedFields = details.SkippedFields,
        };
        return NapperRowOutcome.Mapped(draft);
    }

    private sealed record SleepKind(string Value, bool IsInstant, bool HasDetails);
}

/// <summary>
/// <c>MEDICINE</c> -> medication (an instant). The free-text comment is split into medication names
/// (<see cref="MedicationTokenizer"/>) that the import resolves against the catalog; the comment is not kept as notes.
/// A row naming a medication longer than <see cref="MedicationNameLimits.MaxNameLength"/> is an invalid record.
/// </summary>
internal sealed class MedicineMapper : INapperCategoryMapper
{
    public EventType Type => BuiltInEventTypes.Medication;

    public bool CanHandle(string category) => category == "MEDICINE";

    public NapperRowOutcome Map(NapperLogRow row)
    {
        var tokens = MedicationTokenizer.Split(row.Comment);
        return tokens switch
        {
            { Count: 0 } => NapperRowOutcome.Skipped(row, ImportSkipCodes.MissingValue, "comment names no medication."),
            _ when tokens.Any(token => token.Length > MedicationNameLimits.MaxNameLength) =>
                NapperRowOutcome.Skipped(row, ImportSkipCodes.InvalidRecord, $"a medication name is longer than {MedicationNameLimits.MaxNameLength} characters."),
            _ => NapperRowOutcome.Mapped(new NapperEventDraft(row, Type, row.Start, row.Start, EventPayload.Empty, null, tokens)),
        };
    }
}
