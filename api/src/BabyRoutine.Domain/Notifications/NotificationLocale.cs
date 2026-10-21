namespace BabyRoutine.Domain.Notifications;

/// <summary>The language a device renders notification text in: <c>en</c> or <c>pt-BR</c>; anything else becomes <c>en</c>.</summary>
public readonly record struct NotificationLocale
{
    public const int MaxLength = 10;
    private static readonly IReadOnlyList<string> Supported = ["en", "pt-BR"];

    private NotificationLocale(string value)
    {
        Value = value;
    }

    public static NotificationLocale English { get; } = new("en");

    public string Value { get; }

    /// <summary>The supported locale matching <paramref name="value"/> (case-insensitive), or <see cref="English"/>.</summary>
    public static NotificationLocale FromOrDefault(string? value)
    {
        var trimmed = value?.Trim();
        var match = Supported.FirstOrDefault(supported => string.Equals(supported, trimmed, StringComparison.OrdinalIgnoreCase));
        return match is null ? English : new NotificationLocale(match);
    }

    public override string ToString() => Value;
}
