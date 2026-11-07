using Lotties.Domain.Common;

namespace Lotties.Domain.Users;

/// <summary>How a person is shown when she gave no name: a preset code or a custom text (docs/design/45).</summary>
public static class RoleLabels
{
    public const int MaxLength = 100;

    public static IReadOnlyList<string> Presets { get; } =
        ["mother", "father", "stepMother", "stepFather", "sister", "brother", "grandmother", "grandfather", "friend"];

    /// <summary>Trimmed label or <c>null</c> when blank; a preset code in any case is the canonical code.</summary>
    public static string? Normalize(string? label)
    {
        var text = Text.Optional(label, "roleLabel", MaxLength);
        return text is null ? null : Presets.FirstOrDefault(code => string.Equals(code, text, StringComparison.OrdinalIgnoreCase)) ?? text;
    }
}
