using System.Collections.Frozen;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.EventTypes;

/// <summary>
/// The icon names an event type may use: the Material icon names the web client can render
/// (<c>code/web/src/events/iconRegistry.ts</c>; keep both lists in sync).
/// </summary>
public static class EventTypeIcons
{
    /// <summary>Allowed icon names, in the order the web picker shows them.</summary>
    public static IReadOnlyList<string> Names { get; } =
    [
        "local_drink",
        "bedtime",
        "baby_changing_station",
        "bathtub",
        "child_care",
        "medication",
        "sick",
        "opacity",
        "restaurant",
        "favorite",
        "star",
        "water_drop",
        "toys",
        "directions_walk",
        "thermostat",
        "vaccines",
        "cake",
    ];

    private static readonly FrozenSet<string> Allowed = Names.ToFrozenSet(StringComparer.Ordinal);

    public static bool IsAllowed(string? icon) => icon is not null && Allowed.Contains(icon);

    /// <summary>Returns the trimmed <paramref name="icon"/>, or throws <see cref="DomainValidationException"/> when it is not an allowed name.</summary>
    internal static string Ensure(string? icon)
    {
        var trimmed = icon?.Trim();
        return IsAllowed(trimmed)
            ? trimmed!
            : throw new DomainValidationException(nameof(EventType.Icon), $"Icon must be one of: {string.Join(", ", Names)}.");
    }
}
