namespace Lotties.Domain.Predictions;

/// <summary>
/// The diaper payload <c>content</c> values (<see cref="EventTypes.BuiltInEventTypes.Diaper"/>): a wet diaper is one
/// marked <c>WET</c> or <c>MIXED</c>, a dirty one <c>DIRTY</c> or <c>MIXED</c>. Read leniently (case and surrounding
/// spaces ignored); anything else is neither.
/// </summary>
public static class DiaperContents
{
    public const string Wet = "WET";
    public const string Dirty = "DIRTY";
    public const string Mixed = "MIXED";

    public static bool IsWet(string? content) => Is(content, Wet) || Is(content, Mixed);

    public static bool IsDirty(string? content) => Is(content, Dirty) || Is(content, Mixed);

    private static bool Is(string? content, string value) => string.Equals(content?.Trim(), value, StringComparison.OrdinalIgnoreCase);
}
