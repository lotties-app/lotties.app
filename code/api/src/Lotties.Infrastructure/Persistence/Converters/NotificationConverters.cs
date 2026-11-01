using Lotties.Domain.Notifications;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Lotties.Infrastructure.Persistence.Converters;

/// <summary>
/// EF Core converters of the push notification value objects and enums. Enums are stored as their stable lower snake
/// case codes (<see cref="NotificationCodes"/>), the values the spec lists for each column.
/// </summary>
internal static class NotificationConverters
{
    public static readonly ValueConverter<PushEndpoint, string> Endpoint =
        new(endpoint => endpoint.Value, value => PushEndpoint.From(value));

    public static readonly ValueConverter<NotificationLocale, string> Locale =
        new(locale => locale.Value, value => NotificationLocale.FromOrDefault(value));

    public static readonly ValueConverter<NotificationTimeZone, string> TimeZone =
        new(zone => zone.Value, value => NotificationTimeZone.From(value));

    public static readonly ValueConverter<NotificationKey, string> Key =
        new(key => key.Value, value => NotificationKey.From(value));

    /// <summary>The stored SHA-256 (base64url) of an action token.</summary>
    public static readonly ValueConverter<NotificationActionToken, string> ActionTokenHash =
        new(hash => hash.Value, value => StoredTokenHash(value));

    public static readonly ValueConverter<NotificationKind, string> Kind =
        new(kind => NotificationCodes.Of(kind), code => Parse<NotificationKind>(code));

    public static readonly ValueConverter<DeliveryStatus, string> DeliveryStatus =
        new(status => NotificationCodes.Of(status), code => Parse<DeliveryStatus>(code));

    public static readonly ValueConverter<SubscriptionRevokeReason, string> RevokeReason =
        new(reason => NotificationCodes.Of(reason), code => Parse<SubscriptionRevokeReason>(code));

    public static readonly ValueConverter<NotificationActionKind, string> ActionKind =
        new(action => NotificationCodes.Of(action), code => Parse<NotificationActionKind>(code));

    public static TEnum Parse<TEnum>(string code)
        where TEnum : struct, Enum =>
        NotificationCodes.TryParse<TEnum>(code, out var value)
            ? value
            : throw new InvalidOperationException($"Stored {typeof(TEnum).Name} code '{code}' is unknown.");

    public static NotificationActionToken StoredTokenHash(string value) =>
        NotificationActionToken.TryFrom(value, out var hash)
            ? hash
            : throw new InvalidOperationException("Stored action token hash is malformed.");
}
