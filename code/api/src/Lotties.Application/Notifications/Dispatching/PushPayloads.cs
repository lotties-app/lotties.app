using System.Globalization;
using System.Text;
using System.Text.Json;
using Lotties.Domain.Notifications;

namespace Lotties.Application.Notifications.Dispatching;

/// <summary>
/// The encrypted push payload the service worker parses (code/web/src/pwa/sw/payload.ts, design section 8):
/// <c>{v, id, kind, babyId?, rxId?, at, lang, token?, names?{baby, medication?}, snooze?}</c>. Codes, ids and instants
/// only; <c>names</c> only with show-names on; never a dose amount. Never logged.
/// </summary>
public static class PushPayloads
{
    public const int Version = 1;
    private const string InstantFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'";

    /// <param name="deliveryId">The payload <c>id</c> (also the id the snooze action posts to).</param>
    /// <param name="dedupeKey">A snooze re-send key adds <c>snooze: n</c> so the device re-alerts.</param>
    /// <param name="token">The plain action token; absent for tests.</param>
    public static string Build(
        Guid deliveryId,
        NotificationKind kind,
        NotificationContent content,
        NotificationKey dedupeKey,
        NotificationLocale locale,
        NotificationActionToken? token)
    {
        ArgumentNullException.ThrowIfNull(content);
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteNumber("v", Version);
            writer.WriteString("id", deliveryId.ToString("D"));
            writer.WriteString("kind", NotificationCodes.Of(kind));
            WriteOptionalId(writer, "babyId", content.BabyId);
            WriteOptionalId(writer, "rxId", content.PrescriptionId);
            writer.WriteString("at", content.At.UtcDateTime.ToString(InstantFormat, CultureInfo.InvariantCulture));
            writer.WriteString("lang", locale.Value ?? NotificationLocale.English.Value);
            WriteOptionalString(writer, "token", token?.Value);
            WriteNames(writer, content.Names);
            WriteSnooze(writer, dedupeKey.SnoozeNumber);
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    private static void WriteOptionalId(Utf8JsonWriter writer, string name, Guid? id)
    {
        if (id is { } value)
        {
            writer.WriteString(name, value.ToString("D"));
        }
    }

    private static void WriteOptionalString(Utf8JsonWriter writer, string name, string? value)
    {
        if (value is not null)
        {
            writer.WriteString(name, value);
        }
    }

    private static void WriteNames(Utf8JsonWriter writer, NotificationNames? names)
    {
        if (names is null || string.IsNullOrEmpty(names.Baby))
        {
            return;
        }

        writer.WriteStartObject("names");
        writer.WriteString("baby", names.Baby);
        WriteOptionalString(writer, "medication", string.IsNullOrEmpty(names.Medication) ? null : names.Medication);
        writer.WriteEndObject();
    }

    private static void WriteSnooze(Utf8JsonWriter writer, int? snoozeNumber)
    {
        if (snoozeNumber is { } number)
        {
            writer.WriteNumber("snooze", number);
        }
    }
}
