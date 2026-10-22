using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Prescriptions;

/// <summary>
/// When a prescription is given. <see cref="PrescriptionKind.Scheduled"/>: exactly one of <see cref="TimesOfDay"/>,
/// <see cref="EveryMinutes"/> or <see cref="DayParts"/> (part of the day: one dose per chosen part per day, with optional
/// <see cref="DayPartReminders"/> for chosen parts only). <see cref="PrescriptionKind.AsNeeded"/>:
/// <see cref="MinIntervalMinutes"/> required, <see cref="MaxDosesPer24h"/> optional (1-24). Intervals are 15 minutes to 7
/// days. <see cref="Indication"/> (what it is for, e.g. "belly pain") is optional for both kinds, at most 200 characters.
/// Fields that do not belong to the kind are rejected (field-named 400) instead of silently ignored.
/// </summary>
public sealed record PrescriptionSchedule
{
    public const int MinIntervalLimitMinutes = 15;
    public const int MaxIntervalLimitMinutes = 7 * 24 * 60;
    public const int MaxDosesLimit = 24;
    public const int IndicationMaxLength = 200;

    private PrescriptionSchedule()
    {
    }

    private PrescriptionSchedule(
        PrescriptionKind kind,
        TimesOfDay? timesOfDay,
        int? everyMinutes,
        int? minIntervalMinutes,
        int? maxDosesPer24h,
        string? indication,
        DayPartSet? dayParts,
        DayPartReminders? dayPartReminders)
    {
        Kind = kind;
        TimesOfDay = timesOfDay;
        EveryMinutes = everyMinutes;
        MinIntervalMinutes = minIntervalMinutes;
        MaxDosesPer24h = maxDosesPer24h;
        Indication = indication;
        DayParts = dayParts;
        DayPartReminders = dayPartReminders;
    }

    public PrescriptionKind Kind { get; private set; }

    public TimesOfDay? TimesOfDay { get; private set; }

    public int? EveryMinutes { get; private set; }

    public int? MinIntervalMinutes { get; private set; }

    public int? MaxDosesPer24h { get; private set; }

    public string? Indication { get; private set; }

    /// <summary>Scheduled by part of the day: the chosen parts (<c>null</c> for the other schedules).</summary>
    public DayPartSet? DayParts { get; private set; }

    /// <summary>Reminder times of chosen parts; <c>null</c> when reminders are off (the default).</summary>
    public DayPartReminders? DayPartReminders { get; private set; }

    /// <summary>The prescription's own minimum time between doses: the as-needed interval or the scheduled period; <c>null</c> for times of day.</summary>
    public TimeSpan? OwnInterval => (Kind == PrescriptionKind.AsNeeded ? MinIntervalMinutes : EveryMinutes) is { } minutes ? TimeSpan.FromMinutes(minutes) : null;

    public static PrescriptionSchedule Create(
        PrescriptionKind kind,
        TimesOfDay? timesOfDay,
        int? everyMinutes,
        int? minIntervalMinutes,
        int? maxDosesPer24h,
        string? indication,
        DayPartSet? dayParts = null,
        DayPartReminders? dayPartReminders = null)
    {
        var validIndication = Text.Optional(indication, "indication", IndicationMaxLength);
        var times = new ScheduledTimes(timesOfDay, everyMinutes, dayParts, dayPartReminders);
        return kind switch
        {
            PrescriptionKind.Scheduled => Scheduled(times, minIntervalMinutes, maxDosesPer24h, validIndication),
            PrescriptionKind.AsNeeded => AsNeeded(times, minIntervalMinutes, maxDosesPer24h, validIndication),
            _ => throw new DomainValidationException("kind", "kind must be scheduled or asNeeded."),
        };
    }

    private static PrescriptionSchedule Scheduled(ScheduledTimes times, int? minIntervalMinutes, int? maxDosesPer24h, string? indication)
    {
        EnsureAbsent(minIntervalMinutes, "minIntervalMinutes", "as-needed");
        EnsureAbsent(maxDosesPer24h, "maxDosesPer24h", "as-needed");
        if (times.ShapeCount != 1)
        {
            throw new DomainValidationException("timesOfDay", "A scheduled prescription needs exactly one of timesOfDay, everyMinutes or dayParts.");
        }

        var validEvery = times.EveryMinutes is { } every ? (int?)ValidInterval(every, "everyMinutes") : null;
        var reminders = ValidReminders(times.DayParts, times.DayPartReminders);
        return new PrescriptionSchedule(PrescriptionKind.Scheduled, times.TimesOfDay, validEvery, null, null, indication, times.DayParts, reminders);
    }

    private static PrescriptionSchedule AsNeeded(ScheduledTimes times, int? minIntervalMinutes, int? maxDosesPer24h, string? indication)
    {
        EnsureAbsent(times.TimesOfDay, "timesOfDay", "scheduled");
        EnsureAbsent(times.EveryMinutes, "everyMinutes", "scheduled");
        EnsureAbsent(times.DayParts, DayPartSet.Field, "scheduled");
        EnsureAbsent(times.DayPartReminders, Prescriptions.DayPartReminders.Field, "part-of-the-day");
        var interval = minIntervalMinutes is { } minutes
            ? ValidInterval(minutes, "minIntervalMinutes")
            : throw new DomainValidationException("minIntervalMinutes", "An as-needed prescription needs minIntervalMinutes.");
        return new PrescriptionSchedule(PrescriptionKind.AsNeeded, null, null, interval, ValidMaxDoses(maxDosesPer24h), indication, null, null);
    }

    private static DayPartReminders? ValidReminders(DayPartSet? dayParts, DayPartReminders? reminders)
    {
        if (reminders is null)
        {
            return null;
        }

        var chosen = dayParts ?? throw new DomainValidationException(Prescriptions.DayPartReminders.Field, "dayPartReminders is only for part-of-the-day prescriptions.");
        return reminders.Values.All(reminder => chosen.Contains(reminder.Part))
            ? reminders
            : throw new DomainValidationException(Prescriptions.DayPartReminders.Field, "dayPartReminders may only name the chosen dayParts.");
    }

    private static int ValidInterval(int minutes, string field) =>
        minutes is >= MinIntervalLimitMinutes and <= MaxIntervalLimitMinutes
            ? minutes
            : throw new DomainValidationException(field, $"{field} must be between {MinIntervalLimitMinutes} and {MaxIntervalLimitMinutes} minutes (15 minutes to 7 days).");

    private static int? ValidMaxDoses(int? maxDoses) =>
        maxDoses is null or (>= 1 and <= MaxDosesLimit)
            ? maxDoses
            : throw new DomainValidationException("maxDosesPer24h", $"maxDosesPer24h must be between 1 and {MaxDosesLimit}.");

    private static void EnsureAbsent(object? value, string field, string kind)
    {
        if (value is not null)
        {
            throw new DomainValidationException(field, $"{field} is only for {kind} prescriptions.");
        }
    }

    /// <summary>The fields that say when a prescription is given; a scheduled one sets exactly one shape.</summary>
    private sealed record ScheduledTimes(TimesOfDay? TimesOfDay, int? EveryMinutes, DayPartSet? DayParts, DayPartReminders? DayPartReminders)
    {
        public int ShapeCount => (TimesOfDay is null ? 0 : 1) + (EveryMinutes is null ? 0 : 1) + (DayParts is null ? 0 : 1);
    }
}
