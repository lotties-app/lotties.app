using Lotties.Domain.Notifications;

namespace Lotties.Domain.Assistants;

/// <summary>Where the time zone of an assistant answer came from.</summary>
public enum AssistantZoneSource
{
    /// <summary>The caller asked for it (an MCP tool's <c>timeZone</c> argument).</summary>
    Requested,

    /// <summary>The zone the user stored with her notification settings.</summary>
    Stored,

    /// <summary>The adapter's fallback for the request's language (Alexa: <c>pt-*</c> means <c>America/Sao_Paulo</c>).</summary>
    Adapter,

    /// <summary>The user's app language: Portuguese (Brazil) means <c>America/Sao_Paulo</c>.</summary>
    Language,

    /// <summary>Nothing is known: day-based answers use UTC days and say so.</summary>
    Utc,
}

/// <summary>The zone an answer is told in, and why; <see cref="ZoneId"/> is <c>null</c> only for <see cref="AssistantZoneSource.Utc"/>.</summary>
public sealed record AssistantZone(string? ZoneId, AssistantZoneSource Source);

/// <summary>
/// Which time zone an assistant answer uses (docs/design/32-assistants.md section 5): the requested one, else the user's
/// stored one, else the adapter's fallback for the request's language, else <c>America/Sao_Paulo</c> when the user's app
/// language is Portuguese (Brazil), else none (UTC days, reported as such). Every candidate must be a known IANA id;
/// an unknown one is skipped.
/// </summary>
public static class AssistantZoneChoice
{
    /// <summary>The zone of a Portuguese (Brazil) user who stored none.</summary>
    public const string BrazilZone = "America/Sao_Paulo";

    /// <summary>The id answers report when no zone is known (UTC days).</summary>
    public const string UtcId = "UTC";

    private const string BrazilianPortuguese = "pt-BR";

    public static AssistantZone Decide(string? requested, string? stored, string? adapterFallback, string? appLocale)
    {
        var candidates = new (string? Zone, AssistantZoneSource Source)[]
        {
            (requested, AssistantZoneSource.Requested),
            (stored, AssistantZoneSource.Stored),
            (adapterFallback, AssistantZoneSource.Adapter),
            (string.Equals(appLocale?.Trim(), BrazilianPortuguese, StringComparison.OrdinalIgnoreCase) ? BrazilZone : null, AssistantZoneSource.Language),
        };
        foreach (var (zone, source) in candidates)
        {
            if (NotificationTimeZone.TryFrom(zone, out var known))
            {
                return new AssistantZone(known.Value, source);
            }
        }

        return new AssistantZone(null, AssistantZoneSource.Utc);
    }
}
