using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Prescriptions;

/// <summary>
/// When a prescription is given. <see cref="PrescriptionKind.Scheduled"/>: exactly one of <see cref="TimesOfDay"/> or
/// <see cref="EveryMinutes"/>. <see cref="PrescriptionKind.AsNeeded"/>: <see cref="MinIntervalMinutes"/> required,
/// <see cref="MaxDosesPer24h"/> optional (1-24). Intervals are 15 minutes to 7 days. <see cref="Indication"/> (what it is
/// for, e.g. "belly pain") is optional for both kinds, at most 200 characters. Fields that do not belong to the kind are
/// rejected (field-named 400) instead of silently ignored.
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

    private PrescriptionSchedule(PrescriptionKind kind, TimesOfDay? timesOfDay, int? everyMinutes, int? minIntervalMinutes, int? maxDosesPer24h, string? indication)
    {
        Kind = kind;
        TimesOfDay = timesOfDay;
        EveryMinutes = everyMinutes;
        MinIntervalMinutes = minIntervalMinutes;
        MaxDosesPer24h = maxDosesPer24h;
        Indication = indication;
    }

    public PrescriptionKind Kind { get; private set; }

    public TimesOfDay? TimesOfDay { get; private set; }

    public int? EveryMinutes { get; private set; }

    public int? MinIntervalMinutes { get; private set; }

    public int? MaxDosesPer24h { get; private set; }

    public string? Indication { get; private set; }

    /// <summary>The prescription's own minimum time between doses: the as-needed interval or the scheduled period; <c>null</c> for times of day.</summary>
    public TimeSpan? OwnInterval => (Kind == PrescriptionKind.AsNeeded ? MinIntervalMinutes : EveryMinutes) is { } minutes ? TimeSpan.FromMinutes(minutes) : null;

    public static PrescriptionSchedule Create(
        PrescriptionKind kind,
        TimesOfDay? timesOfDay,
        int? everyMinutes,
        int? minIntervalMinutes,
        int? maxDosesPer24h,
        string? indication)
    {
        var validIndication = Text.Optional(indication, "indication", IndicationMaxLength);
        return kind switch
        {
            PrescriptionKind.Scheduled => Scheduled(timesOfDay, everyMinutes, minIntervalMinutes, maxDosesPer24h, validIndication),
            PrescriptionKind.AsNeeded => AsNeeded(timesOfDay, everyMinutes, minIntervalMinutes, maxDosesPer24h, validIndication),
            _ => throw new DomainValidationException("kind", "kind must be scheduled or asNeeded."),
        };
    }

    private static PrescriptionSchedule Scheduled(TimesOfDay? timesOfDay, int? everyMinutes, int? minIntervalMinutes, int? maxDosesPer24h, string? indication)
    {
        EnsureAbsent(minIntervalMinutes, "minIntervalMinutes", "as-needed");
        EnsureAbsent(maxDosesPer24h, "maxDosesPer24h", "as-needed");
        if ((timesOfDay is null) == (everyMinutes is null))
        {
            throw new DomainValidationException("timesOfDay", "A scheduled prescription needs exactly one of timesOfDay or everyMinutes.");
        }

        var validEvery = everyMinutes is null ? null : (int?)ValidInterval(everyMinutes.Value, "everyMinutes");
        return new PrescriptionSchedule(PrescriptionKind.Scheduled, timesOfDay, validEvery, null, null, indication);
    }

    private static PrescriptionSchedule AsNeeded(TimesOfDay? timesOfDay, int? everyMinutes, int? minIntervalMinutes, int? maxDosesPer24h, string? indication)
    {
        EnsureAbsent(timesOfDay, "timesOfDay", "scheduled");
        EnsureAbsent(everyMinutes, "everyMinutes", "scheduled");
        var interval = minIntervalMinutes is { } minutes
            ? ValidInterval(minutes, "minIntervalMinutes")
            : throw new DomainValidationException("minIntervalMinutes", "An as-needed prescription needs minIntervalMinutes.");
        return new PrescriptionSchedule(PrescriptionKind.AsNeeded, null, null, interval, ValidMaxDoses(maxDosesPer24h), indication);
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
}
