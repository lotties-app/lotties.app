using System.Security.Cryptography;
using System.Text.RegularExpressions;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Babies;

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
        var encoded = Convert.ToBase64String(RandomNumberGenerator.GetBytes(GeneratedByteCount));
        return new InviteToken(encoded.TrimEnd('=').Replace('+', '-').Replace('/', '_'));
    }

    public static InviteToken From(string? value)
    {
        if (value is null || value.Length < MinLength || value.Length > MaxLength || !Pattern().IsMatch(value))
        {
            throw new DomainValidationException("Token", "Invite token is malformed.");
        }

        return new InviteToken(value);
    }

    public override string ToString() => Value;

    [GeneratedRegex("^[A-Za-z0-9_-]+$", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
