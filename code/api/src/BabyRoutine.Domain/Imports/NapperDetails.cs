using System.Collections.Frozen;
using System.Globalization;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Imports;

/// <summary>
/// Maps the optional detail columns of one Napper row (pauses, how the sleep went) into payload fields, collecting the
/// notes lines for values that have no field and the <see cref="ImportSkippedField"/>s for values that cannot be used
/// (each also kept as a notes line with its raw value, so nothing is lost). Never skips the row. Empty cells and zero
/// pauses add nothing.
/// <list type="bullet">
/// <item><c>numberOfPauses</c> -> <c>pause_count</c> (0-100); <c>pausedMinutes</c> -> <c>paused_seconds</c> (minutes x 60,
/// rounded; at most one day and at most the event's length).</item>
/// <item><c>howBabySlept</c> -> <c>how_slept</c>: IN_BED in_bed, WORN_OR_HELD held, BOTTLE bottle, NURSING nursing,
/// STROLLER stroller, CAR car, SWING swing, NEXT_TO_ME / CO_SLEEPING next_to_me, OTHER other; any other value is
/// <c>other</c> plus a notes line with the raw value.</item>
/// <item><c>howBabyWoke</c> -> <c>how_woke</c>: a value containing NATURAL (e.g. WOKE_UP_NATURALLY) is <c>naturally</c>,
/// any other value containing WOKE, WOKEN or WAKE is <c>woken</c>; else skipped.</item>
/// <item><c>babyMoodOnWakeUp</c> GOOD|NEUTRAL|BAD -> <c>mood_on_wake</c>; else skipped. <c>babyMoodOnSleep</c> has no
/// field: always a notes line.</item>
/// <item><c>timeToFallAsleep</c> -> <c>time_to_fall_asleep_minutes</c>: a number up to 240 is minutes, a larger one is
/// seconds (divided by 60); rounded to whole minutes; negative, unreadable or more than 240 minutes is skipped.</item>
/// </list>
/// Values are compared trimmed, case-insensitively, with spaces and hyphens read as underscores.
/// </summary>
internal sealed class NapperDetails(NapperLogRow row)
{
    private const int MaxRawValueLength = 100;
    private const decimal SecondsPerMinute = 60m;
    private const decimal MaxPausedSeconds = PauseFields.MaxPausedSeconds;

    private static readonly FrozenDictionary<string, string> HowSlept = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["IN_BED"] = "in_bed",
        ["WORN_OR_HELD"] = "held",
        ["BOTTLE"] = "bottle",
        ["NURSING"] = "nursing",
        ["STROLLER"] = "stroller",
        ["CAR"] = "car",
        ["SWING"] = "swing",
        ["NEXT_TO_ME"] = "next_to_me",
        ["CO_SLEEPING"] = "next_to_me",
        ["OTHER"] = "other",
    }.ToFrozenDictionary(StringComparer.Ordinal);

    private static readonly FrozenDictionary<string, string> Moods = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["GOOD"] = "good",
        ["NEUTRAL"] = "neutral",
        ["BAD"] = "bad",
    }.ToFrozenDictionary(StringComparer.Ordinal);

    private static readonly string[] WokenMarkers = ["WOKE", "WOKEN", "WAKE"];

    private readonly List<string?> _notes = [];
    private readonly List<ImportSkippedField> _skipped = [];

    /// <summary>Notes lines in column order; <c>null</c> entries are ignored by <see cref="NapperNotes.Compose"/>.</summary>
    public string?[] NotesLines => _notes.ToArray();

    public IReadOnlyList<ImportSkippedField> SkippedFields => _skipped.ToArray();

    /// <summary>Adds <c>pause_count</c> and <c>paused_seconds</c> for an event from <paramref name="start"/> to <paramref name="end"/>.</summary>
    public PayloadBuilder AddPauses(PayloadBuilder payload, DateTimeOffset start, DateTimeOffset end) => payload
        .With(PauseFields.PauseCount, PauseCount())
        .With(PauseFields.PausedSeconds, PausedSeconds((int)Math.Floor((end - start).TotalSeconds)));

    /// <summary>The nap/night detail fields (built-in sleep, see <see cref="SleepDetailFields"/>).</summary>
    public PayloadBuilder AddSleepDetails(PayloadBuilder payload)
    {
        _notes.Add(NapperNotes.Line("Mood on sleep", row.BabyMoodOnSleep));
        return payload
            .With(SleepDetailFields.HowSlept, HowSleptOption())
            .With(SleepDetailFields.MoodOnWake, Option("babyMoodOnWakeUp", "Mood on wake-up", row.BabyMoodOnWakeUp, Moods.GetValueOrDefault))
            .With(SleepDetailFields.HowWoke, Option("howBabyWoke", "How baby woke", row.HowBabyWoke, HowWokeOption))
            .With(SleepDetailFields.TimeToFallAsleepMinutes, TimeToFallAsleepMinutes());
    }

    /// <summary>For sleep kinds without detail fields (night waking, markers): every sleep column becomes a notes line.</summary>
    public PayloadBuilder AddSleepNotes(PayloadBuilder payload)
    {
        _notes.Add(NapperNotes.Line("Mood on wake-up", row.BabyMoodOnWakeUp));
        _notes.Add(NapperNotes.Line("Mood on sleep", row.BabyMoodOnSleep));
        _notes.Add(NapperNotes.Line("How baby slept", row.HowBabySlept));
        _notes.Add(NapperNotes.Line("How baby woke", row.HowBabyWoke));
        _notes.Add(NapperNotes.Line("Time to fall asleep", row.TimeToFallAsleep));
        return payload;
    }

    private static string Normalize(string value) => value.Trim().ToUpperInvariant().Replace(' ', '_').Replace('-', '_');

    private static string? HowWokeOption(string normalized) => normalized switch
    {
        _ when normalized.Contains("NATURAL", StringComparison.Ordinal) => "naturally",
        _ when WokenMarkers.Any(marker => normalized.Contains(marker, StringComparison.Ordinal)) => "woken",
        _ => null,
    };

    private string? HowSleptOption()
    {
        if (string.IsNullOrWhiteSpace(row.HowBabySlept))
        {
            return null;
        }

        var known = HowSlept.GetValueOrDefault(Normalize(row.HowBabySlept));
        _notes.Add(known is null ? NapperNotes.Line("How baby slept", row.HowBabySlept) : null);
        return known ?? "other";
    }

    private string? Option(string column, string label, string? raw, Func<string, string?> lookup)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return lookup(Normalize(raw)) ?? Skip(column, label, raw, "is not a known value.");
    }

    private int? TimeToFallAsleepMinutes()
    {
        var raw = row.TimeToFallAsleep;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var minutes = ParseNumber(raw) is { } number and >= 0m ? MinutesOf(number) : (decimal?)null;
        return minutes is not null && minutes <= SleepDetailFields.MaxTimeToFallAsleepMinutes
            ? (int)minutes.Value
            : SkipNumber("timeToFallAsleep", "Time to fall asleep", raw, $"must be 0-{SleepDetailFields.MaxTimeToFallAsleepMinutes} minutes (or seconds).");
    }

    /// <summary>Up to <see cref="SleepDetailFields.MaxTimeToFallAsleepMinutes"/> the value is minutes; above, seconds.</summary>
    private static decimal MinutesOf(decimal value) =>
        Math.Round(value <= SleepDetailFields.MaxTimeToFallAsleepMinutes ? value : value / SecondsPerMinute, MidpointRounding.AwayFromZero);

    private int? PauseCount()
    {
        if (row.InvalidCells.TryGetValue("numberOfPauses", out var invalid))
        {
            return SkipNumber("numberOfPauses", "Pauses", invalid, "is not a number.");
        }

        return row.NumberOfPauses switch
        {
            null or 0 => null,
            < 0 or > PauseFields.MaxPauseCount => SkipNumber("numberOfPauses", "Pauses", Invariant(row.NumberOfPauses.Value), $"must be 0-{PauseFields.MaxPauseCount}."),
            var count => count,
        };
    }

    private int? PausedSeconds(int elapsedSeconds)
    {
        if (row.InvalidCells.TryGetValue("pausedMinutes", out var invalid))
        {
            return SkipNumber("pausedMinutes", "Paused minutes", invalid, "is not a number.");
        }

        var seconds = row.PausedMinutes is { } minutes ? Math.Round(minutes * SecondsPerMinute, MidpointRounding.AwayFromZero) : 0m;
        return seconds switch
        {
            0m => null,
            < 0m or > MaxPausedSeconds => SkipNumber("pausedMinutes", "Paused minutes", Invariant(row.PausedMinutes!.Value), "must be 0-1440 minutes."),
            _ when seconds > elapsedSeconds => SkipNumber("pausedMinutes", "Paused minutes", Invariant(row.PausedMinutes!.Value), "is longer than the event."),
            _ => (int)seconds,
        };
    }

    private static decimal? ParseNumber(string text)
    {
        var trimmed = text.Trim();
        var invariant = trimmed.Contains('.') ? trimmed : trimmed.Replace(',', '.');
        return decimal.TryParse(invariant, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var value) ? value : null;
    }

    private static string Invariant(decimal value) => value.ToString(CultureInfo.InvariantCulture);

    private static string Invariant(int value) => value.ToString(CultureInfo.InvariantCulture);

    private int? SkipNumber(string column, string label, string raw, string reason)
    {
        Skip(column, label, raw, reason);
        return null;
    }

    private string? Skip(string column, string label, string raw, string reason)
    {
        var value = raw.Trim();
        var shown = value.Length > MaxRawValueLength ? value[..MaxRawValueLength] : value;
        _notes.Add(NapperNotes.Line(label, value));
        _skipped.Add(new ImportSkippedField(row.RowNumber, row.Category, column, shown, ImportSkipCodes.InvalidValue, $"{column} '{shown}' {reason}"));
        return null;
    }
}
