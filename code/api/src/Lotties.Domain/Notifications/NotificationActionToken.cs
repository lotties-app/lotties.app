using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Lotties.Domain.Notifications;

/// <summary>
/// The single-purpose secret that lets a service worker (which has no access token) snooze or dismiss one delivery.
/// 256 random bits as unpadded base64url; a delivery stores only <see cref="Hash"/>.
/// </summary>
public readonly partial record struct NotificationActionToken
{
    public const int MinLength = 16;
    public const int MaxLength = 128;
    private const int GeneratedByteCount = 32;

    private NotificationActionToken(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static NotificationActionToken Generate() => new(Base64UrlText.Encode(RandomNumberGenerator.GetBytes(GeneratedByteCount)));

    public static bool TryFrom(string? value, out NotificationActionToken token)
    {
        var wellFormed = value is not null && value.Length >= MinLength && value.Length <= MaxLength && Pattern().IsMatch(value);
        token = wellFormed ? new NotificationActionToken(value!) : default;
        return wellFormed;
    }

    /// <summary>The SHA-256 of this token as unpadded base64url (43 characters).</summary>
    public NotificationActionToken Hash() => new(Base64UrlText.Sha256(Value));

    /// <summary>Constant-time comparison of two token values.</summary>
    public bool FixedTimeEquals(NotificationActionToken other) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(Value ?? string.Empty), Encoding.UTF8.GetBytes(other.Value ?? string.Empty));

    public override string ToString() => "[action token]";

    [GeneratedRegex(@"^[A-Za-z0-9_-]+\z", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
