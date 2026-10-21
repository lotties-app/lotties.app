using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Babies;

/// <summary>An unguessable, URL-safe invite token.</summary>
public readonly partial record struct InviteToken
{
    public const int MinLength = 16;
    public const int MaxLength = 128;
    private const int GeneratedByteCount = 32;

    private InviteToken(string value)
    {
        Value = value;
    }

    public string Value { get; }

    /// <summary>Generates a new token from 256 bits of cryptographically secure randomness.</summary>
    public static InviteToken Generate()
    {
        return new InviteToken(ToBase64Url(RandomNumberGenerator.GetBytes(GeneratedByteCount)));
    }

    private static string ToBase64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static InviteToken From(string? value) =>
        TryFrom(value, out var token) ? token : throw new DomainValidationException("Token", "Invite token is malformed.");

    public static bool TryFrom(string? value, out InviteToken token)
    {
        var wellFormed = value is not null && value.Length >= MinLength && value.Length <= MaxLength && Pattern().IsMatch(value);
        token = wellFormed ? new InviteToken(value!) : default;
        return wellFormed;
    }

    /// <summary>
    /// The SHA-256 of this token as an unpadded base64url token (43 characters). Invites persist only this hash, so a
    /// leaked database does not leak usable invite links; the plain token is never stored.
    /// </summary>
    public InviteToken Hash()
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(Value));
        return new InviteToken(ToBase64Url(digest));
    }

    public override string ToString() => Value;

    [GeneratedRegex(@"^[A-Za-z0-9_-]+\z", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
