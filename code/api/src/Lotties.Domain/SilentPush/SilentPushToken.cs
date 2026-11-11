using Lotties.Domain.Exceptions;
using Lotties.Domain.Notifications;

namespace Lotties.Domain.SilentPush;

/// <summary>
/// The address a push service gave one app install: an APNs device token (hexadecimal, stored in lower case) or an FCM
/// registration token (letters, digits, <c>-</c>, <c>_</c> and <c>:</c>), <see cref="MinLength"/> to
/// <see cref="MaxLength"/> characters. It is a device identifier: never logged or returned, looked up by <see cref="Hash"/>.
/// </summary>
public readonly record struct SilentPushToken
{
    public const int MinLength = 32;
    public const int MaxLength = 512;
    private const string Field = "token";

    private SilentPushToken(SilentPushChannel channel, string value)
    {
        Channel = channel;
        Value = value;
    }

    public SilentPushChannel Channel { get; }

    public string Value { get; }

    /// <summary>SHA-256 of <c>"{channel}:{token}"</c> as unpadded base64url (43 characters), the unique lookup key.</summary>
    public string Hash => Base64UrlText.Sha256($"{SilentPushCodes.Of(Channel)}:{Value}");

    public static SilentPushToken From(SilentPushChannel channel, string? value)
    {
        var token = RequiredText(value);
        return channel switch
        {
            SilentPushChannel.Apns when token.All(char.IsAsciiHexDigit) => new SilentPushToken(channel, token.ToLowerInvariant()),
            SilentPushChannel.Fcm when token.All(IsFcmCharacter) => new SilentPushToken(channel, token),
            _ => throw new DomainValidationException(Field, $"token is not a valid {SilentPushCodes.Of(channel)} token."),
        };
    }

    public override string ToString() => "[device token]";

    private static string RequiredText(string? value)
    {
        var token = value?.Trim() ?? string.Empty;
        return token.Length is >= MinLength and <= MaxLength
            ? token
            : throw new DomainValidationException(Field, $"token must be {MinLength} to {MaxLength} characters.");
    }

    private static bool IsFcmCharacter(char character) => char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or ':';
}
