using Lotties.Domain.Common;

namespace Lotties.Domain.Babies;

/// <summary>
/// The label shown for a baby without a name: a preset code (<c>baby</c>, <c>girl</c>, <c>boy</c>) or a custom text. A
/// label is never a name: assistants never speak it.
/// </summary>
public static class BabyLabels
{
    public const string Default = "baby";
    public const int MaxLength = 100;

    public static IReadOnlyList<string> Presets { get; } = ["baby", "girl", "boy"];

    /// <summary>Trimmed label; blank is <see cref="Default"/>; a preset code in any case is the lower-case code.</summary>
    public static string Normalize(string? label)
    {
        var text = Text.Optional(label, "label", MaxLength);
        if (text is null)
        {
            return Default;
        }

        var preset = Presets.FirstOrDefault(code => string.Equals(code, text, StringComparison.OrdinalIgnoreCase));
        return preset ?? text;
    }

    /// <summary>English text of a label for places with no localization (notification text, file names).</summary>
    public static string Shown(string label) => label switch
    {
        "girl" => "Girl",
        "boy" => "Boy",
        "baby" => "Baby",
        _ => label,
    };
}
