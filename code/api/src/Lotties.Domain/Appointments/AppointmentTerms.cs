using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Appointments;

/// <summary>
/// The full editable state of a baby's appointment: title (required, 1-80 characters), type, start (a UTC instant,
/// 2000-01-01 to 2100-12-31; it may be in the past, to log a visit after the fact), optional duration (5-480 minutes),
/// location (200), doctor's name (80), notes (2000), outcome (2000, usually filled after the visit), status and the
/// reminder offsets, and an optional link to a care provider of the directory. Text is trimmed, blank optional text is absent, NUL is rejected. The rule that needs the clock
/// (<c>done</c> only once started) lives in <see cref="Appointment"/>. Compared by value, so an idempotent replay
/// changes nothing.
/// </summary>
public sealed record AppointmentTerms
{
    public const int TitleMaxLength = 80;
    public const int LocationMaxLength = 200;
    public const int DoctorNameMaxLength = 80;
    public const int NotesMaxLength = 2000;
    public const int OutcomeMaxLength = 2000;
    public const int MinDurationMinutes = 5;
    public const int MaxDurationMinutes = 480;

    public static readonly DateTimeOffset EarliestStart = new(2000, 1, 1, 0, 0, 0, TimeSpan.Zero);

    /// <summary>The first instant that is too late (starts are allowed up to 2100-12-31 inclusive).</summary>
    public static readonly DateTimeOffset StartLimit = new(2101, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private AppointmentTerms(
        string title,
        AppointmentType type,
        DateTimeOffset startsAt,
        int? durationMinutes,
        string? location,
        string? doctorName,
        string? notes,
        string? outcome,
        AppointmentStatus status,
        AppointmentReminders reminders,
        Guid? providerId)
    {
        Title = title;
        Type = type;
        StartsAt = startsAt;
        DurationMinutes = durationMinutes;
        Location = location;
        DoctorName = doctorName;
        Notes = notes;
        Outcome = outcome;
        Status = status;
        Reminders = reminders;
        ProviderId = providerId;
    }

    public string Title { get; }

    public AppointmentType Type { get; }

    public DateTimeOffset StartsAt { get; }

    public int? DurationMinutes { get; }

    public string? Location { get; }

    public string? DoctorName { get; }

    public string? Notes { get; }

    public string? Outcome { get; }

    public AppointmentStatus Status { get; }

    public AppointmentReminders Reminders { get; }

    /// <summary>The care provider picked from the baby's directory, if any (a plain link: the text fields hold the copied details).</summary>
    public Guid? ProviderId { get; }

    /// <summary>Validates every rule; throws <see cref="DomainValidationException"/> naming the field.</summary>
    public static AppointmentTerms Create(
        string? title,
        AppointmentType type,
        DateTimeOffset startsAt,
        int? durationMinutes,
        string? location,
        string? doctorName,
        string? notes,
        string? outcome,
        AppointmentStatus status,
        AppointmentReminders reminders,
        Guid? providerId = null)
    {
        ArgumentNullException.ThrowIfNull(reminders);
        return new AppointmentTerms(
            Text.Required(title, "title", TitleMaxLength),
            Defined(type, "type"),
            EnsureStart(startsAt),
            EnsureDuration(durationMinutes),
            Text.Optional(location, "location", LocationMaxLength),
            Text.Optional(doctorName, "doctorName", DoctorNameMaxLength),
            Text.Optional(notes, "notes", NotesMaxLength),
            Text.Optional(outcome, "outcome", OutcomeMaxLength),
            Defined(status, "status"),
            reminders,
            providerId == Guid.Empty ? null : providerId);
    }

    private static TEnum Defined<TEnum>(TEnum value, string field)
        where TEnum : struct, Enum =>
        Enum.IsDefined(value) ? value : throw new DomainValidationException(field, $"{field} is not a known value.");

    private static DateTimeOffset EnsureStart(DateTimeOffset startsAt) =>
        startsAt >= EarliestStart && startsAt < StartLimit
            ? UtcTime.Normalize(startsAt)
            : throw new DomainValidationException("startsAt", "startsAt must be between 2000-01-01 and 2100-12-31.");

    private static int? EnsureDuration(int? durationMinutes) =>
        durationMinutes is null or (>= MinDurationMinutes and <= MaxDurationMinutes)
            ? durationMinutes
            : throw new DomainValidationException("durationMinutes", $"durationMinutes must be between {MinDurationMinutes} and {MaxDurationMinutes}.");
}
