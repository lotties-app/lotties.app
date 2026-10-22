using System.Globalization;
using System.Text.RegularExpressions;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Notifications;

/// <summary>
/// The idempotency key of a reminder. A base key names the item once: <c>dose:{prescriptionId:N}:{slot utc yyyyMMddHHmm}</c>,
/// <c>nap:{babyId:N}:{anchor utc yyyyMMddHHmm}</c>, <c>belly:{babyId:N}:{local date yyyyMMdd}</c>,
/// <c>overtired:{babyId:N}:{awake since utc yyyyMMddHHmm}</c>, <c>fussy:{babyId:N}:{local date yyyyMMdd}</c>,
/// <c>wet:{babyId:N}:{anchor utc yyyyMMddHHmm}</c>, <c>dirty:{babyId:N}:{anchor utc yyyyMMddHHmm}</c>,
/// <c>appt:{appointmentId:N}:{start utc yyyyMMddHHmm}:{offset minutes}</c>, <c>proposal:{proposalId:N}</c>,
/// <c>recommendation:{noteId:N}</c> (the doctor suggestions) or <c>test:{deliveryId:N}</c>.
/// A snooze re-send uses the dedupe key
/// <c>{base}:s{n}</c> (<see cref="Snoozed"/>). The device notification tag is always the base key.
/// </summary>
public readonly partial record struct NotificationKey
{
    public const int BaseMaxLength = 120;
    public const int MaxLength = 124;
    private const string InstantFormat = "yyyyMMddHHmm";
    private const string SnoozeMarker = ":s";
    private const string AppointmentPrefix = "appt";
    private const string ProposalPrefix = "proposal";
    private const string RecommendationPrefix = "recommendation";

    private NotificationKey(string value)
    {
        Value = value;
    }

    public string Value { get; }

    /// <summary>Whether this is a snooze re-send key (<c>{base}:s{n}</c>).</summary>
    public bool IsSnoozeResend => Value.Contains(SnoozeMarker, StringComparison.Ordinal);

    /// <summary>The base key: this key without its snooze suffix.</summary>
    public NotificationKey Base => IsSnoozeResend ? new NotificationKey(Value[..Value.LastIndexOf(SnoozeMarker, StringComparison.Ordinal)]) : this;

    /// <summary>The snooze number <c>n</c> of a re-send key <c>{base}:s{n}</c>, or <c>null</c> for a base key.</summary>
    public int? SnoozeNumber =>
        IsSnoozeResend
            ? int.Parse(Value.AsSpan(Value.LastIndexOf(SnoozeMarker, StringComparison.Ordinal) + SnoozeMarker.Length), NumberStyles.None, CultureInfo.InvariantCulture)
            : null;

    /// <summary>
    /// The prescription and the slot a dose key (<c>dose:{prescriptionId:N}:{slot}</c>, snoozed or not) names; <c>false</c>
    /// for other kinds. Lets a retry rebuild the payload from the stored key.
    /// </summary>
    public bool TryGetDose(out Guid prescriptionId, out DateTimeOffset slot)
    {
        var parts = (Value ?? string.Empty).Split(':');
        var isDose = parts.Length >= 3 && parts[0] == "dose";
        var hasId = Guid.TryParseExact(isDose ? parts[1] : string.Empty, "N", out var id);
        var hasSlot = DateTime.TryParseExact(
            isDose ? parts[2] : string.Empty,
            InstantFormat,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var utc);
        var found = isDose && hasId && hasSlot;
        prescriptionId = found ? id : Guid.Empty;
        slot = found ? new DateTimeOffset(utc, TimeSpan.Zero) : default;
        return found;
    }

    /// <summary>
    /// The appointment and its reminder an appointment key (<c>appt:{appointmentId:N}:{start}:{offset}</c>, snoozed or
    /// not) names; <c>false</c> for other kinds. Lets a retry rebuild the payload from the stored key.
    /// </summary>
    public bool TryGetAppointment(out Guid appointmentId, out DateTimeOffset startsAt, out int offsetMinutes)
    {
        var parts = (Value ?? string.Empty).Split(':');
        var isAppointment = parts.Length >= 4 && parts[0] == AppointmentPrefix;
        var hasId = Guid.TryParseExact(isAppointment ? parts[1] : string.Empty, "N", out var id);
        var hasStart = DateTime.TryParseExact(
            isAppointment ? parts[2] : string.Empty,
            InstantFormat,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var utc);
        var hasOffset = int.TryParse(isAppointment ? parts[3] : string.Empty, NumberStyles.None, CultureInfo.InvariantCulture, out var offset);
        var found = isAppointment && hasId && hasStart && hasOffset;
        appointmentId = found ? id : Guid.Empty;
        startsAt = found ? new DateTimeOffset(utc, TimeSpan.Zero) : default;
        offsetMinutes = found ? offset : 0;
        return found;
    }

    /// <summary>
    /// The doctor suggestion a key (<c>proposal:{id:N}</c> or <c>recommendation:{id:N}</c>, snoozed or not) names;
    /// <c>false</c> for other kinds. Lets a retry rebuild the payload from the stored key.
    /// </summary>
    public bool TryGetDoctorSuggestion(out DoctorSuggestionSource source, out Guid id)
    {
        var parts = (Value ?? string.Empty).Split(':');
        var prefix = parts.Length >= 2 ? parts[0] : string.Empty;
        var known = prefix is ProposalPrefix or RecommendationPrefix;
        var hasId = Guid.TryParseExact(known ? parts[1] : string.Empty, "N", out var parsed);
        var found = known && hasId;
        source = prefix == RecommendationPrefix ? DoctorSuggestionSource.Recommendation : DoctorSuggestionSource.Proposal;
        id = found ? parsed : Guid.Empty;
        return found;
    }

    /// <summary>The doctor suggestion <paramref name="id"/> (a proposal or a recommendation note): one notification per suggestion and member.</summary>
    public static NotificationKey ForDoctorSuggestion(DoctorSuggestionSource source, Guid id) =>
        new(string.Create(CultureInfo.InvariantCulture, $"{(source == DoctorSuggestionSource.Recommendation ? RecommendationPrefix : ProposalPrefix)}:{id:N}"));

    public static NotificationKey ForDose(Guid prescriptionId, DateTimeOffset slot) => new($"dose:{prescriptionId:N}:{Instant(slot)}");

    /// <summary>
    /// The reminder <paramref name="offsetMinutes"/> before the appointment <paramref name="appointmentId"/> that starts at
    /// <paramref name="startsAt"/>: moving the start is a new key, so the reminders of the new time are planned again.
    /// </summary>
    public static NotificationKey ForAppointment(Guid appointmentId, DateTimeOffset startsAt, int offsetMinutes) =>
        new(string.Create(CultureInfo.InvariantCulture, $"{AppointmentPrefix}:{appointmentId:N}:{Instant(startsAt)}:{offsetMinutes}"));

    public static NotificationKey ForNap(Guid babyId, DateTimeOffset anchor) => new($"nap:{babyId:N}:{Instant(anchor)}");

    public static NotificationKey ForTest(Guid deliveryId) => new($"test:{deliveryId:N}");

    /// <summary>The belly pain pattern reminder of <paramref name="babyId"/> for the window starting on the local date <paramref name="windowDate"/> (one per day).</summary>
    public static NotificationKey ForBellyPain(Guid babyId, DateOnly windowDate) =>
        new(string.Create(CultureInfo.InvariantCulture, $"belly:{babyId:N}:{windowDate:yyyyMMdd}"));

    /// <summary>The overtired heads-up of <paramref name="babyId"/> for the awake stretch that started at <paramref name="awakeSince"/> (one per stretch).</summary>
    public static NotificationKey ForOvertired(Guid babyId, DateTimeOffset awakeSince) => new($"overtired:{babyId:N}:{Instant(awakeSince)}");

    /// <summary>The fussy pattern reminder of <paramref name="babyId"/> for the window starting on the local date <paramref name="windowDate"/> (one per day).</summary>
    public static NotificationKey ForFussy(Guid babyId, DateOnly windowDate) =>
        new(string.Create(CultureInfo.InvariantCulture, $"fussy:{babyId:N}:{windowDate:yyyyMMdd}"));

    /// <summary>The wet diaper heads-up of <paramref name="babyId"/> for the expectation anchored at the latest wet diaper <paramref name="anchor"/> (one per anchor).</summary>
    public static NotificationKey ForDiaperWet(Guid babyId, DateTimeOffset anchor) => new($"wet:{babyId:N}:{Instant(anchor)}");

    /// <summary>
    /// The dirty diaper heads-up of <paramref name="babyId"/> for the expectation anchored at <paramref name="anchor"/>:
    /// the end of the feed (after-feed signal) or the latest dirty diaper (gap signal). One per anchor.
    /// </summary>
    public static NotificationKey ForDiaperDirty(Guid babyId, DateTimeOffset anchor) => new($"dirty:{babyId:N}:{Instant(anchor)}");

    /// <summary>The dedupe key of the <paramref name="snoozeNumber"/>-th snooze re-send of this base key (1 to <see cref="NotificationRules.MaxSnoozes"/>).</summary>
    public NotificationKey Snoozed(int snoozeNumber)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(snoozeNumber, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(snoozeNumber, NotificationRules.MaxSnoozes);
        return new NotificationKey(string.Create(CultureInfo.InvariantCulture, $"{Base.Value}{SnoozeMarker}{snoozeNumber}"));
    }

    public static NotificationKey From(string? value) =>
        TryFrom(value, out var key) ? key : throw new DomainValidationException("key", "Notification key is malformed.");

    public static bool TryFrom(string? value, out NotificationKey key)
    {
        var wellFormed = value is not null && value.Length <= MaxLength && Pattern().IsMatch(value);
        key = wellFormed ? new NotificationKey(value!) : default;
        return wellFormed;
    }

    public override string ToString() => Value;

    private static string Instant(DateTimeOffset value) => value.UtcDateTime.ToString(InstantFormat, CultureInfo.InvariantCulture);

    [GeneratedRegex(@"^(?:(?:dose|nap|overtired|wet|dirty):[0-9a-f]{32}:[0-9]{12}|appt:[0-9a-f]{32}:[0-9]{12}:[1-9][0-9]{0,4}|(?:belly|fussy):[0-9a-f]{32}:[0-9]{8}|(?:proposal|recommendation|test):[0-9a-f]{32})(?::s[1-9])?\z", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
