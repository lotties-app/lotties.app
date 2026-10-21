using System.Globalization;
using System.Text.RegularExpressions;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Notifications;

/// <summary>
/// The idempotency key of a reminder. A base key names the item once: <c>dose:{prescriptionId:N}:{slot utc yyyyMMddHHmm}</c>,
/// <c>nap:{babyId:N}:{anchor utc yyyyMMddHHmm}</c> or <c>test:{deliveryId:N}</c>. A snooze re-send uses the dedupe key
/// <c>{base}:s{n}</c> (<see cref="Snoozed"/>). The device notification tag is always the base key.
/// </summary>
public readonly partial record struct NotificationKey
{
    public const int BaseMaxLength = 120;
    public const int MaxLength = 124;
    private const string InstantFormat = "yyyyMMddHHmm";
    private const string SnoozeMarker = ":s";

    private NotificationKey(string value)
    {
        Value = value;
    }

    public string Value { get; }

    /// <summary>Whether this is a snooze re-send key (<c>{base}:s{n}</c>).</summary>
    public bool IsSnoozeResend => Value.Contains(SnoozeMarker, StringComparison.Ordinal);

    /// <summary>The base key: this key without its snooze suffix.</summary>
    public NotificationKey Base => IsSnoozeResend ? new NotificationKey(Value[..Value.LastIndexOf(SnoozeMarker, StringComparison.Ordinal)]) : this;

    public static NotificationKey ForDose(Guid prescriptionId, DateTimeOffset slot) => new($"dose:{prescriptionId:N}:{Instant(slot)}");

    public static NotificationKey ForNap(Guid babyId, DateTimeOffset anchor) => new($"nap:{babyId:N}:{Instant(anchor)}");

    public static NotificationKey ForTest(Guid deliveryId) => new($"test:{deliveryId:N}");

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

    [GeneratedRegex(@"^(?:(?:dose|nap):[0-9a-f]{32}:[0-9]{12}|test:[0-9a-f]{32})(?::s[1-9])?\z", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
