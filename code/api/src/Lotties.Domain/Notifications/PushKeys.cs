using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Notifications;

/// <summary>
/// The browser's encryption keys of a subscription (RFC 8291), as base64url: <see cref="P256dh"/> an uncompressed P-256
/// public key (65 bytes starting with <c>0x04</c>) and <see cref="Auth"/> the 16-byte authentication secret.
/// </summary>
public readonly record struct PushKeys
{
    public const int P256dhMaxLength = 88;
    public const int AuthMaxLength = 24;
    private const int P256dhBytes = 65;
    private const byte UncompressedPointPrefix = 0x04;
    private const int AuthBytes = 16;

    private PushKeys(string p256dh, string auth)
    {
        P256dh = p256dh;
        Auth = auth;
    }

    public string P256dh { get; }

    public string Auth { get; }

    public static PushKeys Create(string? p256dh, string? auth) =>
        new(
            Checked(p256dh, P256dhMaxLength, "keys.p256dh", bytes => bytes.Length == P256dhBytes && bytes[0] == UncompressedPointPrefix),
            Checked(auth, AuthMaxLength, "keys.auth", bytes => bytes.Length == AuthBytes));

    public override string ToString() => "[push keys]";

    private static string Checked(string? value, int maxLength, string field, Func<byte[], bool> isExpectedKey)
    {
        var trimmed = value?.Trim();
        var decoded = string.IsNullOrEmpty(trimmed) || trimmed.Length > maxLength ? null : Base64UrlText.TryDecode(trimmed);
        return decoded is not null && isExpectedKey(decoded)
            ? trimmed!
            : throw new DomainValidationException(field, $"{field} is not a valid base64url key of the expected size.");
    }
}
